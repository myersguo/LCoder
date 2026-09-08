use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::Read,
    path::{Component, Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    DirectoryEntry, DirectoryPage, EntryKind, FileSearchMatch, FileSearchPage, FileView,
    WatchState, WorkspaceSummary,
};

const MAX_DIRECTORY_PAGE_SIZE: usize = 500;
const MAX_FILE_SEARCH_RESULTS: usize = 200;
const MAX_FILE_SEARCH_SCAN_ENTRIES: usize = 100_000;
const MAX_FILE_SEARCH_QUERY_BYTES: usize = 256;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_RELATIVE_PATH_BYTES: usize = 32 * 1024;

pub struct Workspace {
    pub id: String,
    pub root: PathBuf,
    pub(crate) revision: Arc<AtomicU64>,
    pub(crate) _watcher: Option<RecommendedWatcher>,
    pub(crate) warning: Option<String>,
}

pub struct WorkspaceRegistry {
    workspaces: Mutex<HashMap<String, Arc<Workspace>>>,
    trusted_paths: Mutex<HashSet<PathBuf>>,
    trust_path: PathBuf,
    recent_path: PathBuf,
}

impl WorkspaceRegistry {
    pub fn new(config_directory: PathBuf) -> Self {
        let trust_path = config_directory.join("trusted-workspaces.json");
        let trusted_paths = fs::read(&trust_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Vec<PathBuf>>(&bytes).ok())
            .unwrap_or_default()
            .into_iter()
            .collect();
        Self {
            workspaces: Mutex::new(HashMap::new()),
            trusted_paths: Mutex::new(trusted_paths),
            trust_path,
            recent_path: config_directory.join("recent-workspace.txt"),
        }
    }

    pub fn register(&self, path: impl AsRef<Path>) -> Result<WorkspaceSummary, String> {
        let root = fs::canonicalize(path).map_err(|error| error.to_string())?;
        if !root.is_dir() {
            return Err("Selected path is not a directory".to_owned());
        }
        if let Some(existing) = self
            .workspaces
            .lock()
            .map_err(|_| "Workspace registry is unavailable".to_owned())?
            .values()
            .find(|workspace| workspace.root == root)
            .cloned()
        {
            persist_recent(&self.recent_path, &root)?;
            return self.summary(&existing);
        }

        let revision = Arc::new(AtomicU64::new(1));
        let event_revision = Arc::clone(&revision);
        let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            if event.is_ok() {
                event_revision.fetch_add(1, Ordering::Relaxed);
            }
        })
        .and_then(|mut watcher| {
            watcher.watch(&root, RecursiveMode::Recursive)?;
            Ok(watcher)
        });
        let (watcher, warning) = match watcher {
            Ok(watcher) => (Some(watcher), None),
            Err(error) => (
                None,
                Some(format!(
                    "Automatic refresh is unavailable; use Refresh ({error})"
                )),
            ),
        };

        let workspace = Arc::new(Workspace {
            id: Uuid::new_v4().to_string(),
            root: root.clone(),
            revision,
            _watcher: watcher,
            warning,
        });
        let summary = self.summary(&workspace)?;
        let mut workspaces = self
            .workspaces
            .lock()
            .map_err(|_| "Workspace registry is unavailable".to_owned())?;
        workspaces.clear();
        workspaces.insert(workspace.id.clone(), workspace);
        drop(workspaces);
        persist_recent(&self.recent_path, &root)?;
        Ok(summary)
    }

    pub fn register_recent(&self) -> Result<Option<WorkspaceSummary>, String> {
        let path = match fs::read_to_string(&self.recent_path) {
            Ok(path) => path,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.to_string()),
        };
        match self.register(path.trim()) {
            Ok(summary) => Ok(Some(summary)),
            Err(_) => {
                let _ = fs::remove_file(&self.recent_path);
                Ok(None)
            }
        }
    }

    pub fn get(&self, id: &str) -> Result<Arc<Workspace>, String> {
        self.workspaces
            .lock()
            .map_err(|_| "Workspace registry is unavailable".to_owned())?
            .get(id)
            .cloned()
            .ok_or_else(|| "Workspace is not registered".to_owned())
    }

    pub fn set_trusted(&self, id: &str, trusted: bool) -> Result<WorkspaceSummary, String> {
        let workspace = self.get(id)?;
        let mut paths = self
            .trusted_paths
            .lock()
            .map_err(|_| "Workspace trust store is unavailable".to_owned())?;
        let mut next_paths = paths.clone();
        if trusted {
            next_paths.insert(workspace.root.clone());
        } else {
            next_paths.remove(&workspace.root);
        }
        persist_trust(&self.trust_path, &next_paths)?;
        *paths = next_paths;
        drop(paths);
        self.summary(&workspace)
    }

    pub fn is_trusted(&self, workspace: &Workspace) -> Result<bool, String> {
        Ok(self
            .trusted_paths
            .lock()
            .map_err(|_| "Workspace trust store is unavailable".to_owned())?
            .contains(&workspace.root))
    }

    pub fn list_directory(
        &self,
        id: &str,
        relative_path: &str,
        offset: usize,
        limit: usize,
    ) -> Result<DirectoryPage, String> {
        if limit == 0 || limit > MAX_DIRECTORY_PAGE_SIZE {
            return Err(format!(
                "Directory page size must be between 1 and {MAX_DIRECTORY_PAGE_SIZE}"
            ));
        }
        let workspace = self.get(id)?;
        let directory = safe_existing_path(&workspace.root, relative_path)?;
        if !directory.is_dir() {
            return Err("Workspace path is not a directory".to_owned());
        }

        let mut entries = Vec::new();
        let mut warning_count = 0;
        for result in fs::read_dir(directory).map_err(|error| error.to_string())? {
            let entry = result.map_err(|error| error.to_string())?;
            if entry.file_name() == ".git" {
                continue;
            }
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                warning_count += 1;
                entries.push(DirectoryEntry {
                    kind: EntryKind::Unsupported,
                    name: "Non-UTF-8 name".to_owned(),
                    path: None,
                    message: Some("This entry cannot be represented safely in the UI".to_owned()),
                });
                continue;
            };
            let relative = normalized_relative_text(
                entry
                    .path()
                    .strip_prefix(&workspace.root)
                    .map_err(|_| "Workspace entry escaped the root".to_owned())?,
            )?;
            let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
            let kind = if metadata.file_type().is_symlink() {
                EntryKind::Symlink
            } else if metadata.is_dir() {
                EntryKind::Directory
            } else if metadata.is_file() {
                EntryKind::File
            } else {
                EntryKind::Unsupported
            };
            entries.push(DirectoryEntry {
                kind,
                name,
                path: Some(relative),
                message: None,
            });
        }
        entries.sort_by(|left, right| {
            entry_rank(left.kind)
                .cmp(&entry_rank(right.kind))
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
                .then_with(|| left.name.cmp(&right.name))
        });
        let end = offset.saturating_add(limit).min(entries.len());
        let page = if offset >= entries.len() {
            Vec::new()
        } else {
            entries[offset..end].to_vec()
        };
        Ok(DirectoryPage {
            entries: page,
            next_offset: (end < entries.len()).then_some(end),
            warning_count,
        })
    }

    pub fn read_file(&self, id: &str, relative_path: &str) -> Result<FileView, String> {
        let workspace = self.get(id)?;
        read_workspace_file(&workspace.root, relative_path)
    }

    pub fn search_files(&self, id: &str, query: &str) -> Result<FileSearchPage, String> {
        let workspace = self.get(id)?;
        let query = query.trim();
        if query.len() > MAX_FILE_SEARCH_QUERY_BYTES {
            return Err(format!(
                "File filter must be at most {MAX_FILE_SEARCH_QUERY_BYTES} bytes"
            ));
        }
        let query = query.to_lowercase();
        if query.is_empty() {
            return Ok(FileSearchPage {
                matches: Vec::new(),
                truncated: false,
            });
        }

        let mut matches = Vec::new();
        let mut pending = vec![workspace.root.clone()];
        let mut scanned = 0;
        let mut truncated = false;
        while let Some(directory) = pending.pop() {
            let entries = match fs::read_dir(&directory) {
                Ok(entries) => entries,
                Err(_) => continue,
            };
            for result in entries {
                let Ok(entry) = result else {
                    continue;
                };
                if entry.file_name() == ".git" {
                    continue;
                }
                scanned += 1;
                if scanned > MAX_FILE_SEARCH_SCAN_ENTRIES {
                    truncated = true;
                    break;
                }
                let Ok(metadata) = fs::symlink_metadata(entry.path()) else {
                    continue;
                };
                if metadata.file_type().is_symlink() {
                    continue;
                }
                if metadata.is_dir() {
                    if !is_search_ignored_directory(&entry.file_name()) {
                        pending.push(entry.path());
                    }
                    continue;
                }
                if !metadata.is_file() {
                    continue;
                }
                let entry_path = entry.path();
                let Ok(relative) = entry_path.strip_prefix(&workspace.root) else {
                    continue;
                };
                let Ok(path) = normalized_relative_text(relative) else {
                    continue;
                };
                if path.to_lowercase().contains(&query) {
                    matches.push(FileSearchMatch {
                        name: entry.file_name().to_string_lossy().into_owned(),
                        path,
                    });
                }
            }
            if truncated {
                break;
            }
        }
        matches.sort_by(|left, right| {
            left.path
                .to_lowercase()
                .cmp(&right.path.to_lowercase())
                .then_with(|| left.path.cmp(&right.path))
        });
        if matches.len() > MAX_FILE_SEARCH_RESULTS {
            matches.truncate(MAX_FILE_SEARCH_RESULTS);
            truncated = true;
        }
        Ok(FileSearchPage { matches, truncated })
    }

    pub fn watch(&self, id: &str, after_revision: u64) -> Result<WatchState, String> {
        let workspace = self.get(id)?;
        let revision = workspace.revision.load(Ordering::Relaxed);
        Ok(WatchState {
            changed: revision > after_revision,
            revision,
        })
    }

    fn summary(&self, workspace: &Workspace) -> Result<WorkspaceSummary, String> {
        Ok(WorkspaceSummary {
            id: workspace.id.clone(),
            name: workspace
                .root
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("Workspace")
                .to_owned(),
            path: workspace.root.to_string_lossy().into_owned(),
            trusted: self.is_trusted(workspace)?,
            watching: workspace._watcher.is_some(),
            warning: workspace.warning.clone(),
        })
    }
}

pub(crate) fn safe_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    if relative_path.len() > MAX_RELATIVE_PATH_BYTES {
        return Err("Workspace relative path is too long".to_owned());
    }
    let mut normalized = PathBuf::new();
    for component in Path::new(relative_path).components() {
        match component {
            Component::Normal(value) => normalized.push(value),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Workspace path must stay inside the workspace".to_owned());
            }
        }
    }
    Ok(normalized)
}

pub(crate) fn safe_existing_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    let relative = safe_relative_path(relative_path)?;
    let mut candidate = root.clone();
    for component in relative.components() {
        candidate.push(component.as_os_str());
        let metadata = fs::symlink_metadata(&candidate).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() {
            return Err("Symbolic links are not opened in LCoder".to_owned());
        }
    }
    let canonical = fs::canonicalize(&candidate).map_err(|error| error.to_string())?;
    if !canonical.starts_with(&root) {
        return Err("Workspace path must stay inside the workspace".to_owned());
    }
    Ok(canonical)
}

pub(crate) fn read_workspace_bytes(root: &Path, relative_path: &str) -> Result<Vec<u8>, String> {
    let path = safe_existing_path(root, relative_path)?;
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("Workspace path is not a regular file".to_owned());
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err(format!("File exceeds the {MAX_FILE_BYTES} byte limit"));
    }
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|error| error.to_string())?
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(format!("File exceeds the {MAX_FILE_BYTES} byte limit"));
    }
    Ok(bytes)
}

fn read_workspace_file(root: &Path, relative_path: &str) -> Result<FileView, String> {
    let path = safe_existing_path(root, relative_path)?;
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("Workspace path is not a regular file".to_owned());
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Ok(FileView::Unsupported {
            path: relative_path.replace('\\', "/"),
            reason: format!("File is larger than {} MiB", MAX_FILE_BYTES / 1024 / 1024),
            size: metadata.len(),
        });
    }
    let bytes = read_workspace_bytes(root, relative_path)?;
    if bytes.contains(&0) {
        return Ok(FileView::Unsupported {
            path: relative_path.replace('\\', "/"),
            reason: "Binary files are not rendered".to_owned(),
            size: bytes.len() as u64,
        });
    }
    let Ok(content) = String::from_utf8(bytes.clone()) else {
        return Ok(FileView::Unsupported {
            path: relative_path.replace('\\', "/"),
            reason: "Only UTF-8 text is supported in V1".to_owned(),
            size: bytes.len() as u64,
        });
    };
    let version = format!("{:x}", Sha256::digest(&bytes));
    Ok(FileView::Text {
        path: relative_path.replace('\\', "/"),
        content,
        version,
    })
}

fn persist_trust(path: &Path, trusted: &HashSet<PathBuf>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut paths = trusted.iter().collect::<Vec<_>>();
    paths.sort();
    let bytes = serde_json::to_vec_pretty(&paths).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    set_private_permissions(&temporary)?;
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

fn persist_recent(path: &Path, workspace: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, workspace.to_string_lossy().as_bytes())
        .map_err(|error| error.to_string())?;
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

fn normalized_relative_text(path: &Path) -> Result<String, String> {
    path.components()
        .map(|component| {
            component
                .as_os_str()
                .to_str()
                .ok_or_else(|| "Workspace path is not valid UTF-8".to_owned())
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|parts| parts.join("/"))
}

fn is_search_ignored_directory(name: &std::ffi::OsStr) -> bool {
    matches!(
        name.to_str(),
        Some(".git" | "node_modules" | "target" | "dist" | "build" | ".next")
    )
}

const fn entry_rank(kind: EntryKind) -> u8 {
    match kind {
        EntryKind::Directory => 0,
        EntryKind::File => 1,
        EntryKind::Symlink => 2,
        EntryKind::Unsupported => 3,
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn rejects_parent_paths_and_symlinks() {
        let directory = tempdir().expect("tempdir");
        fs::write(directory.path().join("ok.txt"), "hello").expect("write fixture");
        assert!(safe_existing_path(directory.path(), "../escape").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/tmp", directory.path().join("outside"))
                .expect("create symlink");
            assert!(safe_existing_path(directory.path(), "outside").is_err());
            fs::create_dir(directory.path().join("target")).expect("create target");
            fs::write(directory.path().join("target/inside.txt"), "inside").expect("write target");
            std::os::unix::fs::symlink("target", directory.path().join("inside-link"))
                .expect("create internal symlink");
            assert!(safe_existing_path(directory.path(), "inside-link/inside.txt").is_err());
        }
    }

    #[test]
    fn reads_text_and_rejects_binary_content() {
        let directory = tempdir().expect("tempdir");
        fs::write(directory.path().join("text.rs"), "fn main() {}\n").expect("write text");
        fs::write(directory.path().join("binary"), [0_u8, 1, 2]).expect("write binary");

        assert!(matches!(
            read_workspace_file(directory.path(), "text.rs").expect("read text"),
            FileView::Text { .. }
        ));
        assert!(matches!(
            read_workspace_file(directory.path(), "binary").expect("read binary"),
            FileView::Unsupported { .. }
        ));
    }

    #[test]
    fn searches_files_recursively_without_following_symlinks() {
        let directory = tempdir().expect("tempdir");
        fs::create_dir_all(directory.path().join("src/parser")).expect("create source");
        fs::write(directory.path().join("src/parser/lexer.rs"), "lexer").expect("write lexer");
        fs::write(directory.path().join("src/parser/syntax.rs"), "syntax").expect("write syntax");
        fs::create_dir(directory.path().join(".git")).expect("create git directory");
        fs::write(directory.path().join(".git/hidden.rs"), "hidden").expect("write hidden");
        fs::create_dir(directory.path().join("target")).expect("create target directory");
        fs::write(directory.path().join("target/lexer-cache.rs"), "cache")
            .expect("write ignored cache");
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            directory.path().join("src"),
            directory.path().join("linked-src"),
        )
        .expect("create symlink");

        let registry = WorkspaceRegistry::new(directory.path().join("config"));
        let summary = registry.register(directory.path()).expect("register");
        let result = registry
            .search_files(&summary.id, "LEX")
            .expect("search files");

        assert_eq!(
            result.matches,
            vec![FileSearchMatch {
                name: "lexer.rs".to_owned(),
                path: "src/parser/lexer.rs".to_owned(),
            }]
        );
        assert!(!result.truncated);
        assert!(
            registry
                .search_files(&summary.id, "")
                .expect("empty search")
                .matches
                .is_empty()
        );
        assert!(
            registry
                .search_files(&summary.id, &"x".repeat(257))
                .is_err()
        );
    }
}
