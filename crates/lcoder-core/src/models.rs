use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSummary {
    pub id: String,
    pub name: String,
    pub path: String,
    pub trusted: bool,
    pub watching: bool,
    pub warning: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EntryKind {
    Directory,
    File,
    Symlink,
    Unsupported,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub kind: EntryKind,
    pub name: String,
    pub path: Option<String>,
    pub message: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryPage {
    pub entries: Vec<DirectoryEntry>,
    pub next_offset: Option<usize>,
    pub warning_count: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileView {
    Text {
        path: String,
        content: String,
        version: String,
    },
    Unsupported {
        path: String,
        reason: String,
        size: u64,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchState {
    pub changed: bool,
    pub revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositorySummary {
    pub is_repository: bool,
    pub branch: Option<String>,
    pub detached: bool,
    pub unborn: bool,
    pub dirty_files: usize,
    pub workspace_prefix: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeStatus {
    Added,
    Copied,
    Deleted,
    Modified,
    Renamed,
    TypeChanged,
    Unmerged,
    Untracked,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
    pub path: String,
    pub original_path: Option<String>,
    pub staged: Option<ChangeStatus>,
    pub unstaged: Option<ChangeStatus>,
    pub status: ChangeStatus,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePage {
    pub changes: Vec<GitChange>,
    pub next_offset: Option<usize>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub oid: String,
    pub short_oid: String,
    pub parent_oids: Vec<String>,
    pub author: String,
    pub authored_at: i64,
    pub subject: String,
    pub message: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitPage {
    pub commits: Vec<CommitSummary>,
    pub next_offset: Option<usize>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileComparison {
    Text {
        path: String,
        original_path: Option<String>,
        baseline: String,
        status: ChangeStatus,
        original: String,
        modified: String,
    },
    Unsupported {
        path: String,
        original_path: Option<String>,
        baseline: String,
        status: ChangeStatus,
        reason: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalProfile {
    pub id: String,
    pub label: String,
    pub available: bool,
    pub executable: Option<String>,
    pub version: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInfo {
    pub id: String,
    pub profile_id: String,
    pub title: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TerminalEvent {
    Output {
        session_id: String,
        data: Vec<u8>,
    },
    Exit {
        session_id: String,
        code: u32,
        signal: Option<String>,
    },
    Error {
        session_id: String,
        message: String,
    },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRequest {
    pub workspace_id: String,
    pub offset: usize,
    pub limit: usize,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePathRequest {
    pub workspace_id: String,
    pub path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitRequest {
    pub workspace_id: String,
    pub oid: String,
    pub offset: usize,
    pub limit: usize,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFileRequest {
    pub workspace_id: String,
    pub oid: String,
    pub path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingFileRequest {
    pub workspace_id: String,
    pub path: String,
}
