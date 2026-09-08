use std::{
    env,
    ffi::{OsStr, OsString},
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::Duration,
};

use wait_timeout::ChildExt;

const MAX_PROCESS_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
const PROCESS_TIMEOUT: Duration = Duration::from_secs(10);

pub(crate) struct CommandOutput {
    pub stdout: Vec<u8>,
}

pub(crate) fn find_executable(name: &str) -> Option<PathBuf> {
    let candidate = Path::new(name);
    if candidate.is_absolute() {
        return canonical_executable(candidate);
    }
    executable_paths()
        .into_iter()
        .map(|directory| directory.join(name))
        .find_map(|path| canonical_executable(&path))
}

pub(crate) fn command_path() -> OsString {
    env::join_paths(executable_paths()).unwrap_or_else(|_| OsString::from("/usr/bin:/bin"))
}

pub(crate) fn canonical_executable(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() || !is_executable(path) {
        return None;
    }
    fs::canonicalize(path)
        .ok()
        .filter(|canonical| canonical.is_absolute() && is_executable(canonical))
}

fn executable_paths() -> Vec<PathBuf> {
    let mut paths = env::var_os("PATH")
        .map(|value| env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    paths.retain(|path| path.is_absolute());
    for common in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
        let path = PathBuf::from(common);
        if !paths.contains(&path) {
            paths.push(path);
        }
    }
    if let Some(home) = env::var_os("HOME") {
        let local_bin = PathBuf::from(home).join(".local/bin");
        if local_bin.is_absolute() && !paths.contains(&local_bin) {
            paths.push(local_bin);
        }
    }
    paths
}

pub(crate) fn run_bounded(
    program: &Path,
    arguments: &[OsString],
    cwd: Option<&Path>,
    environment: &[(&str, &OsStr)],
    removed_environment: &[OsString],
    fallback: &str,
) -> Result<CommandOutput, String> {
    let mut command = Command::new(program);
    command
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    for key in removed_environment {
        command.env_remove(key);
    }
    for (key, value) in environment {
        command.env(key, value);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("{fallback}: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("{fallback}: stdout is unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| format!("{fallback}: stderr is unavailable"))?;
    let stdout_reader = thread::spawn(move || read_stream(stdout));
    let stderr_reader = thread::spawn(move || read_stream(stderr));

    let status = match child
        .wait_timeout(PROCESS_TIMEOUT)
        .map_err(|error| format!("{fallback}: {error}"))?
    {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(format!("{fallback}: timed out after 10 seconds"));
        }
    };
    let stdout = stdout_reader
        .join()
        .map_err(|_| format!("{fallback}: stdout reader failed"))??;
    let stderr = stderr_reader
        .join()
        .map_err(|_| format!("{fallback}: stderr reader failed"))??;
    if stdout.truncated || stderr.truncated {
        return Err(format!(
            "{fallback}: command output exceeded the {MAX_PROCESS_OUTPUT_BYTES} byte limit"
        ));
    }
    if !status.success() {
        let message = String::from_utf8_lossy(&stderr.bytes).trim().to_owned();
        return Err(if message.is_empty() {
            fallback.to_owned()
        } else {
            message
        });
    }
    Ok(CommandOutput {
        stdout: stdout.bytes,
    })
}

struct BoundedBytes {
    bytes: Vec<u8>,
    truncated: bool,
}

fn read_stream(mut stream: impl Read) -> Result<BoundedBytes, String> {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 8192];
    let mut truncated = false;
    loop {
        let read = stream
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        if bytes.len() < MAX_PROCESS_OUTPUT_BYTES {
            let remaining = MAX_PROCESS_OUTPUT_BYTES - bytes.len();
            bytes.extend_from_slice(&buffer[..read.min(remaining)]);
            truncated |= read > remaining;
        } else {
            truncated = true;
        }
    }
    Ok(BoundedBytes { bytes, truncated })
}

fn is_executable(path: &Path) -> bool {
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
    use super::*;

    #[test]
    fn rejects_relative_explicit_executable_paths() {
        assert!(canonical_executable(Path::new("relative/tool")).is_none());
    }
}
