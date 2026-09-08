use std::sync::Arc;

use lcoder_core::{
    ChangePage, CommitFileRequest, CommitPage, CommitRequest, DirectoryPage, FileComparison,
    FileSearchPage, FileView, PageRequest, RepositorySummary, TerminalController, TerminalEvent,
    TerminalInfo, TerminalProfile, WatchState, WorkingFileRequest, WorkspacePathRequest,
    WorkspaceRegistry, WorkspaceSummary, commit_changes, commit_file,
    git_history as read_git_history, repository_summary, working_changes, working_file,
};
use tauri::{AppHandle, Manager, State, ipc::Channel};
use tauri_plugin_dialog::DialogExt;

struct AppState {
    workspaces: Arc<WorkspaceRegistry>,
    terminals: TerminalController,
}

#[tauri::command]
async fn workspace_choose(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<WorkspaceSummary>, String> {
    let terminals = state.terminals.clone();
    terminals.stop_all();
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    app.dialog().file().pick_folder(move |path| {
        let _ = sender.send(path);
    });
    let selected = tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    let Some(path) = selected else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|error| error.to_string())?;
    let workspaces = Arc::clone(&state.workspaces);
    tauri::async_runtime::spawn_blocking(move || workspaces.register(path))
        .await
        .map_err(|error| error.to_string())
        .and_then(|result| result.map(Some))
}

#[tauri::command]
async fn workspace_recent(state: State<'_, AppState>) -> Result<Option<WorkspaceSummary>, String> {
    let workspaces = Arc::clone(&state.workspaces);
    tauri::async_runtime::spawn_blocking(move || workspaces.register_recent())
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn workspace_directory(
    state: State<'_, AppState>,
    workspace_id: String,
    path: String,
    offset: usize,
    limit: usize,
) -> Result<DirectoryPage, String> {
    let workspaces = Arc::clone(&state.workspaces);
    tauri::async_runtime::spawn_blocking(move || {
        workspaces.list_directory(&workspace_id, &path, offset, limit)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn workspace_file(
    state: State<'_, AppState>,
    request: WorkspacePathRequest,
) -> Result<FileView, String> {
    let workspaces = Arc::clone(&state.workspaces);
    tauri::async_runtime::spawn_blocking(move || {
        workspaces.read_file(&request.workspace_id, &request.path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn workspace_search_files(
    state: State<'_, AppState>,
    workspace_id: String,
    query: String,
) -> Result<FileSearchPage, String> {
    let workspaces = Arc::clone(&state.workspaces);
    tauri::async_runtime::spawn_blocking(move || workspaces.search_files(&workspace_id, &query))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn workspace_watch(
    state: State<'_, AppState>,
    workspace_id: String,
    after_revision: u64,
) -> Result<WatchState, String> {
    state.workspaces.watch(&workspace_id, after_revision)
}

#[tauri::command]
async fn workspace_set_trusted(
    state: State<'_, AppState>,
    workspace_id: String,
    trusted: bool,
) -> Result<WorkspaceSummary, String> {
    let workspaces = Arc::clone(&state.workspaces);
    let terminals = state.terminals.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Trust is revoked before advancing the terminal epoch. A concurrent
        // start then either observes untrusted state or is cancelled by the
        // epoch change.
        let summary = workspaces.set_trusted(&workspace_id, trusted)?;
        if !trusted {
            terminals.stop_all();
        }
        Ok(summary)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn git_repository(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<RepositorySummary, String> {
    let workspace = state.workspaces.get(&workspace_id)?;
    tauri::async_runtime::spawn_blocking(move || repository_summary(&workspace))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn git_working_changes(
    state: State<'_, AppState>,
    request: PageRequest,
) -> Result<ChangePage, String> {
    let workspace = state.workspaces.get(&request.workspace_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        working_changes(&workspace, request.offset, request.limit)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn git_working_file(
    state: State<'_, AppState>,
    request: WorkingFileRequest,
) -> Result<FileComparison, String> {
    let workspace = state.workspaces.get(&request.workspace_id)?;
    tauri::async_runtime::spawn_blocking(move || working_file(&workspace, &request.path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn git_history(
    state: State<'_, AppState>,
    request: PageRequest,
) -> Result<CommitPage, String> {
    let workspace = state.workspaces.get(&request.workspace_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        read_git_history(&workspace, request.offset, request.limit)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn git_commit_changes(
    state: State<'_, AppState>,
    request: CommitRequest,
) -> Result<ChangePage, String> {
    let workspace = state.workspaces.get(&request.workspace_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        commit_changes(&workspace, &request.oid, request.offset, request.limit)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn git_commit_file(
    state: State<'_, AppState>,
    request: CommitFileRequest,
) -> Result<FileComparison, String> {
    let workspace = state.workspaces.get(&request.workspace_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        commit_file(&workspace, &request.oid, &request.path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn terminal_profiles(state: State<'_, AppState>) -> Result<Vec<TerminalProfile>, String> {
    let terminals = state.terminals.clone();
    tauri::async_runtime::spawn_blocking(move || terminals.profiles())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn terminal_profile_choose(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<Option<Vec<TerminalProfile>>, String> {
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    app.dialog().file().pick_file(move |path| {
        let _ = sender.send(path);
    });
    let selected = tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    let Some(path) = selected else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|error| error.to_string())?;
    let terminals = state.terminals.clone();
    tauri::async_runtime::spawn_blocking(move || {
        terminals.set_profile_path(&profile_id, Some(path))
    })
    .await
    .map_err(|error| error.to_string())
    .and_then(|result| result.map(Some))
}

#[tauri::command]
async fn terminal_start(
    state: State<'_, AppState>,
    workspace_id: String,
    profile_id: String,
    rows: u16,
    cols: u16,
    on_event: Channel<TerminalEvent>,
) -> Result<TerminalInfo, String> {
    let workspaces = Arc::clone(&state.workspaces);
    let terminals = state.terminals.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Capture the epoch before the trust check. Revocation persists trust
        // first and then advances the epoch, closing both start/revoke orders.
        let epoch = terminals.epoch();
        let workspace = workspaces.get(&workspace_id)?;
        if !workspaces.is_trusted(&workspace)? {
            return Err("Trust this workspace before starting a terminal".to_owned());
        }
        terminals.start_at_epoch(
            &workspace,
            &profile_id,
            rows,
            cols,
            epoch,
            Arc::new(move |event| {
                let _ = on_event.send(event);
            }),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn terminal_write(
    state: State<'_, AppState>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    state.terminals.write(&session_id, &data)
}

#[tauri::command]
fn terminal_resize(
    state: State<'_, AppState>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    state.terminals.resize(&session_id, rows, cols)
}

#[tauri::command]
fn terminal_ack(
    state: State<'_, AppState>,
    session_id: String,
    bytes: usize,
) -> Result<(), String> {
    state.terminals.acknowledge(&session_id, bytes)
}

#[tauri::command]
async fn terminal_stop(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    let terminals = state.terminals.clone();
    tauri::async_runtime::spawn_blocking(move || terminals.stop(&session_id))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            app.manage(AppState {
                workspaces: Arc::new(WorkspaceRegistry::new(app_data.clone())),
                terminals: TerminalController::new(app_data.join("terminal-profiles.json")),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspace_choose,
            workspace_recent,
            workspace_directory,
            workspace_file,
            workspace_search_files,
            workspace_watch,
            workspace_set_trusted,
            git_repository,
            git_working_changes,
            git_working_file,
            git_history,
            git_commit_changes,
            git_commit_file,
            terminal_profiles,
            terminal_profile_choose,
            terminal_start,
            terminal_write,
            terminal_resize,
            terminal_ack,
            terminal_stop
        ])
        .build(tauri::generate_context!())
        .expect("failed to build LCoder");
    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            handle.state::<AppState>().terminals.stop_all();
        }
    });
}
