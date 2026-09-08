use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, SyncSender, TrySendError},
    },
    thread,
    time::Duration,
};

use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};

use crate::{
    TerminalEvent, TerminalInfo, TerminalProfile,
    process::{canonical_executable, command_path, find_executable},
    workspace::Workspace,
};

const MAX_TERMINAL_MESSAGE_BYTES: usize = 64 * 1024;
const MAX_TERMINAL_SIZE: u16 = 1000;
const OUTPUT_CHUNK_BYTES: usize = 8192;
const OUTPUT_CREDIT_BYTES: usize = 1024 * 1024;
const INPUT_QUEUE_MESSAGES: usize = 64;

type EventSink = Arc<dyn Fn(TerminalEvent) + Send + Sync + 'static>;

struct TerminalSession {
    input: Mutex<Option<SyncSender<Vec<u8>>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    output_credit: Arc<OutputCredit>,
    pid: Option<u32>,
}

struct OutputCredit {
    available: Mutex<usize>,
    changed: Condvar,
    closed: AtomicBool,
}

impl OutputCredit {
    fn new() -> Self {
        Self {
            available: Mutex::new(OUTPUT_CREDIT_BYTES),
            changed: Condvar::new(),
            closed: AtomicBool::new(false),
        }
    }

    fn consume(&self, bytes: usize) -> bool {
        let Ok(mut available) = self.available.lock() else {
            return false;
        };
        while *available < bytes && !self.closed.load(Ordering::Acquire) {
            let Ok(next) = self.changed.wait(available) else {
                return false;
            };
            available = next;
        }
        if self.closed.load(Ordering::Acquire) {
            return false;
        }
        *available -= bytes;
        true
    }

    fn acknowledge(&self, bytes: usize) {
        if let Ok(mut available) = self.available.lock() {
            *available = available.saturating_add(bytes).min(OUTPUT_CREDIT_BYTES);
            self.changed.notify_all();
        }
    }

    fn close(&self) {
        self.closed.store(true, Ordering::Release);
        self.changed.notify_all();
    }
}

struct TerminalInner {
    epoch: AtomicU64,
    next_id: AtomicU64,
    sessions: Mutex<HashMap<String, Arc<TerminalSession>>>,
    starting: Mutex<bool>,
    custom_paths: Mutex<HashMap<String, PathBuf>>,
    config_path: PathBuf,
}

#[derive(Clone)]
pub struct TerminalController {
    inner: Arc<TerminalInner>,
}

impl TerminalController {
    pub fn new(config_path: PathBuf) -> Self {
        let custom_paths = fs::read(&config_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            inner: Arc::new(TerminalInner {
                epoch: AtomicU64::new(0),
                next_id: AtomicU64::new(0),
                sessions: Mutex::new(HashMap::new()),
                starting: Mutex::new(false),
                custom_paths: Mutex::new(custom_paths),
                config_path,
            }),
        }
    }

    pub fn profiles(&self) -> Vec<TerminalProfile> {
        ["shell", "codex", "claude", "traex"]
            .into_iter()
            .map(|id| {
                let executable = self.resolve_profile(id);
                TerminalProfile {
                    id: id.to_owned(),
                    label: profile_label(id).to_owned(),
                    available: executable.is_some(),
                    version: (id == "shell")
                        .then(|| executable.as_deref().and_then(executable_name))
                        .flatten(),
                    executable: executable.map(|path| path.to_string_lossy().into_owned()),
                }
            })
            .collect()
    }

    pub fn epoch(&self) -> u64 {
        self.inner.epoch.load(Ordering::Acquire)
    }

    pub fn set_profile_path(
        &self,
        profile_id: &str,
        path: Option<PathBuf>,
    ) -> Result<Vec<TerminalProfile>, String> {
        validate_profile(profile_id)?;
        let mut paths = self
            .inner
            .custom_paths
            .lock()
            .map_err(|_| "Terminal profile settings are unavailable".to_owned())?;
        let mut next_paths = paths.clone();
        match path {
            Some(path) => {
                let canonical = fs::canonicalize(path).map_err(|error| error.to_string())?;
                if !is_executable_file(&canonical) {
                    return Err("Terminal executable is not an executable file".to_owned());
                }
                next_paths.insert(profile_id.to_owned(), canonical);
            }
            None => {
                next_paths.remove(profile_id);
            }
        }
        persist_paths(&self.inner.config_path, &next_paths)?;
        *paths = next_paths;
        drop(paths);
        Ok(self.profiles())
    }

    pub fn start_at_epoch(
        &self,
        workspace: &Workspace,
        profile_id: &str,
        rows: u16,
        cols: u16,
        epoch: u64,
        event_sink: EventSink,
    ) -> Result<TerminalInfo, String> {
        validate_profile(profile_id)?;
        let mut starting = self
            .inner
            .starting
            .lock()
            .map_err(|_| "Terminal startup state is unavailable".to_owned())?;
        if self.epoch() != epoch {
            return Err("Terminal start was cancelled".to_owned());
        }
        {
            let sessions = self
                .inner
                .sessions
                .lock()
                .map_err(|_| "Terminal state is unavailable".to_owned())?;
            if !sessions.is_empty() || *starting {
                return Err("Only one terminal can run in this window".to_owned());
            }
            *starting = true;
        }
        drop(starting);
        let _startup_guard = StartupGuard(Arc::clone(&self.inner));
        let executable = self
            .resolve_profile(profile_id)
            .ok_or_else(|| format!("{} is not installed", profile_label(profile_id)))?;
        let (rows, cols) = bounded_size(rows, cols);
        let pair = native_pty_system()
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("Unable to create terminal: {error}"))?;
        let mut command = CommandBuilder::new(&executable);
        command.cwd(&workspace.root);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        command.env("PATH", command_path());
        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| format!("Unable to start {}: {error}", profile_label(profile_id)))?;
        drop(pair.slave);
        let pid = child.process_id();
        let killer = child.clone_killer();
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("Unable to read terminal output: {error}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| format!("Unable to open terminal input: {error}"))?;
        let (input_tx, input_rx) = mpsc::sync_channel::<Vec<u8>>(INPUT_QUEUE_MESSAGES);
        thread::spawn(move || {
            let mut writer = writer;
            while let Ok(bytes) = input_rx.recv() {
                if writer
                    .write_all(&bytes)
                    .and_then(|()| writer.flush())
                    .is_err()
                {
                    break;
                }
            }
        });

        let id = format!(
            "terminal-{}",
            self.inner.next_id.fetch_add(1, Ordering::Relaxed) + 1
        );
        let output_credit = Arc::new(OutputCredit::new());
        let session = Arc::new(TerminalSession {
            input: Mutex::new(Some(input_tx)),
            killer: Mutex::new(killer),
            master: Mutex::new(Some(pair.master)),
            output_credit: Arc::clone(&output_credit),
            pid,
        });
        let mut sessions = self
            .inner
            .sessions
            .lock()
            .map_err(|_| "Terminal state is unavailable".to_owned())?;
        if self.inner.epoch.load(Ordering::Acquire) != epoch {
            drop(sessions);
            let _ = stop_session(&session);
            return Err("Terminal start was cancelled".to_owned());
        }
        sessions.insert(id.clone(), Arc::clone(&session));
        drop(sessions);

        let output_sink = Arc::clone(&event_sink);
        let output_id = id.clone();
        let reader_thread = thread::spawn(move || {
            let mut buffer = [0_u8; OUTPUT_CHUNK_BYTES];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => {
                        if !output_credit.consume(read) {
                            break;
                        }
                        output_sink(TerminalEvent::Output {
                            session_id: output_id.clone(),
                            data: buffer[..read].to_vec(),
                        });
                    }
                }
            }
        });
        let inner = Arc::clone(&self.inner);
        let wait_id = id.clone();
        thread::spawn(move || {
            let result = child.wait();
            let _ = reader_thread.join();
            if let Ok(mut sessions) = inner.sessions.lock() {
                sessions.remove(&wait_id);
            }
            match result {
                Ok(status) => event_sink(TerminalEvent::Exit {
                    session_id: wait_id,
                    code: status.exit_code(),
                    signal: status.signal().map(str::to_owned),
                }),
                Err(error) => event_sink(TerminalEvent::Error {
                    session_id: wait_id,
                    message: format!("Unable to wait for terminal process: {error}"),
                }),
            }
        });

        Ok(TerminalInfo {
            id,
            profile_id: profile_id.to_owned(),
            title: profile_label(profile_id).to_owned(),
        })
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        if data.is_empty() || data.len() > MAX_TERMINAL_MESSAGE_BYTES {
            return Err(format!(
                "Terminal input must contain 1–{MAX_TERMINAL_MESSAGE_BYTES} bytes"
            ));
        }
        let session = self.session(id)?;
        let input = session
            .input
            .lock()
            .map_err(|_| "Terminal input is unavailable".to_owned())?;
        match input
            .as_ref()
            .ok_or_else(|| "Terminal input is closed".to_owned())?
            .try_send(data.to_vec())
        {
            Ok(()) => Ok(()),
            Err(TrySendError::Full(_)) => Err("Terminal input queue is full".to_owned()),
            Err(TrySendError::Disconnected(_)) => Err("Terminal input is closed".to_owned()),
        }
    }

    pub fn resize(&self, id: &str, rows: u16, cols: u16) -> Result<(), String> {
        let session = self.session(id)?;
        let (rows, cols) = bounded_size(rows, cols);
        session
            .master
            .lock()
            .map_err(|_| "Terminal resize state is unavailable".to_owned())?
            .as_ref()
            .ok_or_else(|| "Terminal is closed".to_owned())?
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("Unable to resize terminal: {error}"))
    }

    pub fn acknowledge(&self, id: &str, bytes: usize) -> Result<(), String> {
        if bytes == 0 || bytes > OUTPUT_CREDIT_BYTES {
            return Err("Invalid terminal output acknowledgement".to_owned());
        }
        self.session(id)?.output_credit.acknowledge(bytes);
        Ok(())
    }

    pub fn stop(&self, id: &str) -> Result<(), String> {
        let session = self
            .inner
            .sessions
            .lock()
            .map_err(|_| "Terminal state is unavailable".to_owned())?
            .remove(id);
        let Some(session) = session else {
            return Ok(());
        };
        stop_session(&session)
    }

    pub fn stop_all(&self) {
        let _starting = self.inner.starting.lock().ok();
        self.inner.epoch.fetch_add(1, Ordering::AcqRel);
        let sessions = self
            .inner
            .sessions
            .lock()
            .map(|mut sessions| sessions.drain().map(|(_, value)| value).collect::<Vec<_>>())
            .unwrap_or_default();
        for session in sessions {
            let _ = stop_session(&session);
        }
    }

    fn session(&self, id: &str) -> Result<Arc<TerminalSession>, String> {
        self.inner
            .sessions
            .lock()
            .map_err(|_| "Terminal state is unavailable".to_owned())?
            .get(id)
            .cloned()
            .ok_or_else(|| "Terminal session was not found".to_owned())
    }

    fn resolve_profile(&self, profile_id: &str) -> Option<PathBuf> {
        let custom = self
            .inner
            .custom_paths
            .lock()
            .ok()
            .and_then(|paths| paths.get(profile_id).cloned())
            .and_then(|path| canonical_executable(&path));
        if custom.is_some() {
            return custom;
        }
        match profile_id {
            "shell" => std::env::var_os("SHELL")
                .map(PathBuf::from)
                .and_then(|path| canonical_executable(&path))
                .or_else(|| find_executable("zsh"))
                .or_else(|| find_executable("bash"))
                .or_else(|| find_executable("sh")),
            "codex" | "claude" | "traex" => find_executable(profile_id),
            _ => None,
        }
    }
}

struct StartupGuard(Arc<TerminalInner>);

impl Drop for StartupGuard {
    fn drop(&mut self) {
        if let Ok(mut starting) = self.0.starting.lock() {
            *starting = false;
        }
    }
}

impl Drop for TerminalInner {
    fn drop(&mut self) {
        if let Ok(sessions) = self.sessions.get_mut() {
            for (_, session) in sessions.drain() {
                let _ = stop_session(&session);
            }
        }
    }
}

fn stop_session(session: &TerminalSession) -> Result<(), String> {
    session.output_credit.close();
    if let Ok(mut input) = session.input.lock() {
        input.take();
    }
    #[cfg(unix)]
    {
        if let Some(pid) = session.pid {
            terminate_unix_session(pid);
        } else {
            let _ = session
                .killer
                .lock()
                .map_err(|_| "Terminal process state is unavailable".to_owned())?
                .kill();
        }
        if let Ok(mut master) = session.master.lock() {
            master.take();
        }
        Ok(())
    }
    #[cfg(not(unix))]
    {
        let result = session
            .killer
            .lock()
            .map_err(|_| "Terminal process state is unavailable".to_owned())?
            .kill()
            .map_err(|error| format!("Unable to stop terminal: {error}"));
        if let Ok(mut master) = session.master.lock() {
            master.take();
        }
        result
    }
}

#[cfg(unix)]
fn terminate_unix_session(pid: u32) {
    signal_unix_session(pid, libc::SIGHUP);
    signal_unix_session(pid, libc::SIGTERM);
    thread::sleep(Duration::from_millis(150));
    signal_unix_session(pid, libc::SIGKILL);
}

#[cfg(unix)]
fn signal_unix_session(session_id: u32, signal: libc::c_int) {
    let session_processes = std::process::Command::new("/bin/ps")
        .args(["-axo", "pid=,sess="])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|output| {
            output
                .lines()
                .filter_map(|line| {
                    let mut fields = line.split_whitespace();
                    let pid = fields.next()?.parse::<libc::pid_t>().ok()?;
                    let sid = fields.next()?.parse::<u32>().ok()?;
                    (sid == session_id).then_some(pid)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if session_processes.is_empty() {
        unsafe {
            libc::kill(-(session_id as libc::pid_t), signal);
        }
        return;
    }
    for pid in session_processes {
        unsafe {
            libc::kill(pid, signal);
        }
    }
}

fn bounded_size(rows: u16, cols: u16) -> (u16, u16) {
    (
        rows.clamp(1, MAX_TERMINAL_SIZE),
        cols.clamp(1, MAX_TERMINAL_SIZE),
    )
}

fn validate_profile(profile_id: &str) -> Result<(), String> {
    if matches!(profile_id, "shell" | "codex" | "claude" | "traex") {
        Ok(())
    } else {
        Err("Unknown terminal profile".to_owned())
    }
}

fn profile_label(profile_id: &str) -> &'static str {
    match profile_id {
        "shell" => "Shell",
        "codex" => "Codex",
        "claude" => "Claude Code",
        "traex" => "TraeX",
        _ => "Terminal",
    }
}

fn executable_name(executable: &Path) -> Option<String> {
    executable
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
}

fn persist_paths(path: &Path, paths: &HashMap<String, PathBuf>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(paths).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    set_private_permissions(&temporary)?;
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

#[cfg(unix)]
fn set_private_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| error.to_string())
}

#[cfg(not(unix))]
fn set_private_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        sync::{Arc, mpsc},
        time::Duration,
    };

    use tempfile::tempdir;

    use crate::workspace::Workspace;

    use super::*;

    #[test]
    fn bounds_terminal_dimensions() {
        assert_eq!(bounded_size(0, 0), (1, 1));
        assert_eq!(
            bounded_size(u16::MAX, u16::MAX),
            (MAX_TERMINAL_SIZE, MAX_TERMINAL_SIZE)
        );
    }

    #[test]
    fn rejects_unknown_profiles() {
        assert!(validate_profile("arbitrary").is_err());
        assert!(validate_profile("codex").is_ok());
    }

    #[test]
    fn rejects_a_start_cancelled_by_an_epoch_change() {
        let directory = tempdir().expect("tempdir");
        let workspace = Workspace {
            id: "test-workspace".to_owned(),
            root: fs::canonicalize(directory.path()).expect("canonical directory"),
            revision: Arc::new(AtomicU64::new(1)),
            _watcher: None,
            warning: None,
        };
        let controller = TerminalController::new(directory.path().join("profiles.json"));
        let epoch = controller.epoch();
        controller.stop_all();

        let result =
            controller.start_at_epoch(&workspace, "shell", 24, 80, epoch, Arc::new(|_| {}));
        assert_eq!(result.unwrap_err(), "Terminal start was cancelled");
    }

    #[test]
    fn runs_a_real_shell_through_the_pty() {
        let directory = tempdir().expect("tempdir");
        let config = directory.path().join("config");
        fs::create_dir_all(&config).expect("config directory");
        let workspace = Workspace {
            id: "test-workspace".to_owned(),
            root: fs::canonicalize(directory.path()).expect("canonical directory"),
            revision: Arc::new(AtomicU64::new(1)),
            _watcher: None,
            warning: None,
        };
        let controller = TerminalController::new(config.join("profiles.json"));
        let (events, receiver) = mpsc::channel();
        let epoch = controller.epoch();
        let info = controller
            .start_at_epoch(
                &workspace,
                "shell",
                24,
                80,
                epoch,
                Arc::new(move |event| {
                    let _ = events.send(event);
                }),
            )
            .expect("start shell");
        controller
            .write(&info.id, b"printf 'lcoder-pty-ok\\n'; exit\n")
            .expect("write shell");

        let mut output = Vec::new();
        let mut exited = false;
        for _ in 0..20 {
            match receiver.recv_timeout(Duration::from_millis(250)) {
                Ok(TerminalEvent::Output { session_id, data }) => {
                    assert_eq!(session_id, info.id);
                    output.extend(data);
                }
                Ok(TerminalEvent::Exit { session_id, .. }) => {
                    assert_eq!(session_id, info.id);
                    exited = true;
                    break;
                }
                Ok(TerminalEvent::Error {
                    session_id,
                    message,
                }) => {
                    assert_eq!(session_id, info.id);
                    panic!("{message}");
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(error) => panic!("{error}"),
            }
        }
        assert!(String::from_utf8_lossy(&output).contains("lcoder-pty-ok"));
        assert!(exited);
    }
}
