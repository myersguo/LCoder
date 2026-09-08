use std::{
    ffi::{OsStr, OsString},
    path::PathBuf,
};

use crate::{
    ChangePage, ChangeStatus, CommitPage, CommitSummary, FileComparison, GitChange,
    RepositorySummary,
    process::{find_executable, run_bounded},
    workspace::{Workspace, read_workspace_bytes, safe_relative_path},
};

const MAX_PAGE_SIZE: usize = 500;
const MAX_COMMIT_PAGE_SIZE: usize = 100;
const MAX_DIFF_BYTES: usize = 4 * 1024 * 1024;

struct RepositoryContext {
    git: PathBuf,
    root: PathBuf,
    prefix: String,
}

#[derive(Clone, Debug)]
struct ParsedDiff {
    change: GitChange,
    old_oid: Option<String>,
    new_oid: Option<String>,
}

pub fn repository_summary(workspace: &Workspace) -> RepositorySummary {
    let context = match repository_context(workspace) {
        Ok(context) => context,
        Err(error) => {
            return RepositorySummary {
                is_repository: false,
                branch: None,
                detached: false,
                unborn: false,
                dirty_files: 0,
                workspace_prefix: None,
                error: Some(error),
            };
        }
    };
    let has_head = git_text(&context, &["rev-parse", "--verify", "HEAD"]).is_ok();
    let branch = git_text(&context, &["symbolic-ref", "--short", "-q", "HEAD"]).ok();
    let (dirty_files, status_error) = match read_status(&context) {
        Ok(items) => (items.len(), None),
        Err(error) => (0, Some(error)),
    };
    RepositorySummary {
        is_repository: true,
        branch,
        detached: has_head && git_text(&context, &["symbolic-ref", "-q", "HEAD"]).is_err(),
        unborn: !has_head,
        dirty_files,
        workspace_prefix: (!context.prefix.is_empty()).then_some(context.prefix),
        error: status_error,
    }
}

pub fn working_changes(
    workspace: &Workspace,
    offset: usize,
    limit: usize,
) -> Result<ChangePage, String> {
    validate_page(limit, MAX_PAGE_SIZE)?;
    let changes = read_status(&repository_context(workspace)?)?;
    Ok(page_changes(changes, offset, limit))
}

pub fn working_file(workspace: &Workspace, relative_path: &str) -> Result<FileComparison, String> {
    safe_relative_path(relative_path)?;
    let context = repository_context(workspace)?;
    let changes = read_status(&context)?;
    let change = changes
        .into_iter()
        .find(|change| change.path == relative_path)
        .ok_or_else(|| "The selected file is no longer changed".to_owned())?;
    if change.status == ChangeStatus::Unmerged {
        return Ok(unsupported_comparison(
            &change,
            "HEAD → working tree",
            "Conflicted files do not have a single two-way comparison",
        ));
    }

    let original_repository_path = workspace_to_repository_path(
        &context,
        change.original_path.as_deref().unwrap_or(&change.path),
    )?;
    let original = if change.status == ChangeStatus::Untracked
        || !git_succeeds(&context, &["rev-parse", "--verify", "HEAD"])
    {
        Vec::new()
    } else {
        read_tree_blob(&context, "HEAD", &original_repository_path)?.unwrap_or_default()
    };
    let modified = if change.status == ChangeStatus::Deleted {
        Vec::new()
    } else {
        read_workspace_bytes(&workspace.root, &change.path)?
    };
    text_comparison(change, "HEAD → working tree", original, modified)
}

pub fn git_history(
    workspace: &Workspace,
    offset: usize,
    limit: usize,
) -> Result<CommitPage, String> {
    validate_page(limit, MAX_COMMIT_PAGE_SIZE)?;
    let context = repository_context(workspace)?;
    if !git_succeeds(&context, &["rev-parse", "--verify", "HEAD"]) {
        return Ok(CommitPage {
            commits: Vec::new(),
            next_offset: None,
        });
    }
    let format = "%H%x00%h%x00%P%x00%an%x00%at%x00%s%x00%B";
    let mut args = vec![
        "log".into(),
        "--no-decorate".into(),
        "--no-show-signature".into(),
        "--no-use-mailmap".into(),
        "-z".into(),
        format!("--format={format}").into(),
        format!("--max-count={}", limit + 1).into(),
        format!("--skip={offset}").into(),
        "HEAD".into(),
    ];
    push_scope(&mut args, &context.prefix);
    let output = run_git(&context, args, "Unable to read commit history")?;
    let mut fields = output.split(|byte| *byte == 0);
    let mut commits = Vec::new();
    while let Some(oid) = next_nonempty(&mut fields) {
        let short_oid = next_field(&mut fields, "short commit id")?;
        let parent_oids = next_field(&mut fields, "commit parents")?;
        let author = next_field(&mut fields, "commit author")?;
        let authored_at = next_field(&mut fields, "commit timestamp")?;
        let subject = next_field(&mut fields, "commit subject")?;
        let message = next_field(&mut fields, "commit message")?;
        commits.push(CommitSummary {
            oid: utf8(oid, "commit id")?,
            short_oid: utf8(short_oid, "short commit id")?,
            parent_oids: utf8(parent_oids, "commit parents")?
                .split_whitespace()
                .map(str::to_owned)
                .collect(),
            author: utf8(author, "commit author")?,
            authored_at: utf8(authored_at, "commit timestamp")?
                .parse()
                .map_err(|_| "Git returned an invalid commit timestamp".to_owned())?,
            subject: utf8(subject, "commit subject")?,
            message: utf8(message, "commit message")?.trim_end().to_owned(),
        });
    }
    let has_more = commits.len() > limit;
    commits.truncate(limit);
    Ok(CommitPage {
        next_offset: has_more.then_some(offset + commits.len()),
        commits,
    })
}

pub fn commit_changes(
    workspace: &Workspace,
    oid: &str,
    offset: usize,
    limit: usize,
) -> Result<ChangePage, String> {
    validate_page(limit, MAX_PAGE_SIZE)?;
    validate_oid(oid)?;
    let context = repository_context(workspace)?;
    let changes = read_commit_diff(&context, oid)?
        .into_iter()
        .map(|diff| diff.change)
        .collect();
    Ok(page_changes(changes, offset, limit))
}

pub fn commit_file(
    workspace: &Workspace,
    oid: &str,
    relative_path: &str,
) -> Result<FileComparison, String> {
    validate_oid(oid)?;
    safe_relative_path(relative_path)?;
    let context = repository_context(workspace)?;
    let diff = read_commit_diff(&context, oid)?
        .into_iter()
        .find(|diff| diff.change.path == relative_path)
        .ok_or_else(|| "The file is not part of this commit".to_owned())?;
    let parent_count = commit_parents(&context, oid)?.len();
    let baseline = if parent_count == 0 {
        "empty tree → commit".to_owned()
    } else if parent_count > 1 {
        "first parent → merge commit".to_owned()
    } else {
        "parent → commit".to_owned()
    };
    if diff.change.status == ChangeStatus::TypeChanged {
        return Ok(unsupported_comparison(
            &diff.change,
            &baseline,
            "Type changes are shown as metadata only",
        ));
    }
    let original = match diff.old_oid {
        Some(oid) => read_blob(&context, &oid)?,
        None => Vec::new(),
    };
    let modified = match diff.new_oid {
        Some(oid) => read_blob(&context, &oid)?,
        None => Vec::new(),
    };
    text_comparison(diff.change, &baseline, original, modified)
}

fn read_status(context: &RepositoryContext) -> Result<Vec<GitChange>, String> {
    let mut args = vec![
        "-c".into(),
        "status.relativePaths=false".into(),
        "status".into(),
        "--porcelain=v1".into(),
        "-z".into(),
        "--untracked-files=all".into(),
        "--renames".into(),
    ];
    push_scope(&mut args, &context.prefix);
    let output = run_git(context, args, "Unable to read Git status")?;
    parse_status(&output, &context.prefix)
}

fn parse_status(bytes: &[u8], prefix: &str) -> Result<Vec<GitChange>, String> {
    let mut fields = bytes.split(|byte| *byte == 0).peekable();
    let mut changes = Vec::new();
    while let Some(field) = fields.next() {
        if field.is_empty() {
            continue;
        }
        if field.len() < 4 || field[2] != b' ' {
            return Err("Git status returned an invalid record".to_owned());
        }
        let x = field[0];
        let y = field[1];
        let repository_path = utf8(&field[3..], "Git path")?;
        let has_rename = matches!(x, b'R' | b'C') || matches!(y, b'R' | b'C');
        let original_repository_path = if has_rename {
            let original = fields
                .next()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "Git rename record is missing the source path".to_owned())?;
            Some(utf8(original, "Git original path")?)
        } else {
            None
        };
        let unmerged = matches!(
            (x, y),
            (b'D', b'D')
                | (b'A', b'U')
                | (b'U', b'D')
                | (b'U', b'A')
                | (b'D', b'U')
                | (b'A', b'A')
                | (b'U', b'U')
        );
        let (staged, unstaged) = if x == b'?' && y == b'?' {
            (None, Some(ChangeStatus::Untracked))
        } else if unmerged {
            (Some(ChangeStatus::Unmerged), Some(ChangeStatus::Unmerged))
        } else {
            (status_code(x)?, status_code(y)?)
        };
        let parsed_status = unstaged.or(staged).unwrap_or(ChangeStatus::Modified);
        let new_scoped = strip_scope(prefix, &repository_path).ok();
        let old_scoped = if has_rename {
            original_repository_path
                .as_deref()
                .and_then(|path| strip_scope(prefix, path).ok())
        } else {
            new_scoped.clone()
        };
        let (path, original_path, status) = scoped_change(old_scoped, new_scoped, parsed_status)?;
        changes.push(GitChange {
            path,
            original_path,
            staged,
            unstaged,
            status,
        });
    }
    changes.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(changes)
}

fn read_commit_diff(context: &RepositoryContext, oid: &str) -> Result<Vec<ParsedDiff>, String> {
    let parents = commit_parents(context, oid)?;
    let mut args = if let Some(parent) = parents.first() {
        vec![
            "diff-tree".into(),
            "-r".into(),
            "--raw".into(),
            "-z".into(),
            "--no-commit-id".into(),
            "--no-ext-diff".into(),
            "--no-textconv".into(),
            "-M".into(),
            parent.clone().into(),
            oid.into(),
        ]
    } else {
        vec![
            "diff-tree".into(),
            "--root".into(),
            "-r".into(),
            "--raw".into(),
            "-z".into(),
            "--no-commit-id".into(),
            "--no-ext-diff".into(),
            "--no-textconv".into(),
            "-M".into(),
            oid.into(),
        ]
    };
    push_scope(&mut args, &context.prefix);
    let output = run_git(context, args, "Unable to read commit changes")?;
    parse_raw_diff(&output, &context.prefix)
}

fn parse_raw_diff(bytes: &[u8], prefix: &str) -> Result<Vec<ParsedDiff>, String> {
    let mut fields = bytes.split(|byte| *byte == 0).peekable();
    let mut changes = Vec::new();
    while let Some(metadata) = fields.next() {
        if metadata.is_empty() {
            continue;
        }
        let metadata = utf8(metadata, "Git raw diff metadata")?;
        let parts = metadata.split_whitespace().collect::<Vec<_>>();
        if parts.len() != 5 || !parts[0].starts_with(':') {
            return Err("Git diff returned invalid metadata".to_owned());
        }
        let status_text = parts[4];
        let status_code = status_text
            .as_bytes()
            .first()
            .copied()
            .ok_or_else(|| "Git diff returned an empty status".to_owned())?;
        let first_path = utf8(
            fields
                .next()
                .ok_or_else(|| "Git diff is missing a path".to_owned())?,
            "Git diff path",
        )?;
        let has_pair = matches!(status_code, b'R' | b'C');
        let (old_repository_path, new_repository_path) = if has_pair {
            let second_path = utf8(
                fields
                    .next()
                    .ok_or_else(|| "Git rename is missing a destination path".to_owned())?,
                "Git diff destination path",
            )?;
            (Some(first_path), Some(second_path))
        } else {
            (Some(first_path.clone()), Some(first_path))
        };
        let old_scoped = old_repository_path
            .as_deref()
            .and_then(|path| strip_scope(prefix, path).ok());
        let new_scoped = new_repository_path
            .as_deref()
            .and_then(|path| strip_scope(prefix, path).ok());
        let (path, original_path, status) =
            scoped_change(old_scoped, new_scoped, status_code_to_change(status_code)?)?;
        let old_oid = old_repository_path
            .as_deref()
            .filter(|path| strip_scope(prefix, path).is_ok())
            .and_then(|_| nonzero_oid(parts[2]));
        let new_oid = new_repository_path
            .as_deref()
            .filter(|path| strip_scope(prefix, path).is_ok())
            .and_then(|_| nonzero_oid(parts[3]));
        changes.push(ParsedDiff {
            change: GitChange {
                path,
                original_path,
                staged: None,
                unstaged: None,
                status,
            },
            old_oid,
            new_oid,
        });
    }
    changes.sort_by(|left, right| left.change.path.cmp(&right.change.path));
    Ok(changes)
}

fn commit_parents(context: &RepositoryContext, oid: &str) -> Result<Vec<String>, String> {
    validate_oid(oid)?;
    let text = git_text(context, &["show", "-s", "--format=%P", oid])?;
    Ok(text.split_whitespace().map(str::to_owned).collect())
}

fn read_tree_blob(
    context: &RepositoryContext,
    tree: &str,
    repository_path: &str,
) -> Result<Option<Vec<u8>>, String> {
    let args = vec![
        "ls-tree".into(),
        "-z".into(),
        tree.into(),
        "--".into(),
        repository_path.into(),
    ];
    let output = run_git(context, args, "Unable to inspect Git tree")?;
    let record = output.split(|byte| *byte == 0).next().unwrap_or_default();
    if record.is_empty() {
        return Ok(None);
    }
    let tab = record
        .iter()
        .position(|byte| *byte == b'\t')
        .ok_or_else(|| "Git tree returned invalid metadata".to_owned())?;
    let metadata = utf8(&record[..tab], "Git tree metadata")?;
    let fields = metadata.split_whitespace().collect::<Vec<_>>();
    if fields.len() != 3 || fields[1] != "blob" {
        return Err("Git path is not a regular text blob".to_owned());
    }
    read_blob(context, fields[2]).map(Some)
}

fn read_blob(context: &RepositoryContext, oid: &str) -> Result<Vec<u8>, String> {
    validate_oid(oid)?;
    run_git(
        context,
        vec!["cat-file".into(), "blob".into(), oid.into()],
        "Unable to read Git object; it may not be available locally",
    )
}

fn text_comparison(
    change: GitChange,
    baseline: &str,
    original: Vec<u8>,
    modified: Vec<u8>,
) -> Result<FileComparison, String> {
    if original.len().saturating_add(modified.len()) > MAX_DIFF_BYTES {
        return Ok(unsupported_comparison(
            &change,
            baseline,
            "Diff exceeds the 4 MiB text limit",
        ));
    }
    if original.contains(&0) || modified.contains(&0) {
        return Ok(unsupported_comparison(
            &change,
            baseline,
            "Binary files are not rendered",
        ));
    }
    let Ok(original) = String::from_utf8(original) else {
        return Ok(unsupported_comparison(
            &change,
            baseline,
            "Only UTF-8 text diffs are supported",
        ));
    };
    let Ok(modified) = String::from_utf8(modified) else {
        return Ok(unsupported_comparison(
            &change,
            baseline,
            "Only UTF-8 text diffs are supported",
        ));
    };
    Ok(FileComparison::Text {
        path: change.path,
        original_path: change.original_path,
        baseline: baseline.to_owned(),
        status: change.status,
        original,
        modified,
    })
}

fn unsupported_comparison(change: &GitChange, baseline: &str, reason: &str) -> FileComparison {
    FileComparison::Unsupported {
        path: change.path.clone(),
        original_path: change.original_path.clone(),
        baseline: baseline.to_owned(),
        status: change.status,
        reason: reason.to_owned(),
    }
}

fn repository_context(workspace: &Workspace) -> Result<RepositoryContext, String> {
    let git = find_executable("git").ok_or_else(|| "Git is not installed".to_owned())?;
    let provisional = RepositoryContext {
        git,
        root: workspace.root.clone(),
        prefix: String::new(),
    };
    let root = PathBuf::from(git_text(&provisional, &["rev-parse", "--show-toplevel"])?);
    let root = std::fs::canonicalize(root).map_err(|error| error.to_string())?;
    if !workspace.root.starts_with(&root) {
        return Err("Workspace is outside the detected Git repository".to_owned());
    }
    let prefix = workspace
        .root
        .strip_prefix(&root)
        .map_err(|_| "Workspace is outside the detected Git repository".to_owned())?
        .components()
        .map(|component| {
            component
                .as_os_str()
                .to_str()
                .ok_or_else(|| "Git workspace path is not valid UTF-8".to_owned())
        })
        .collect::<Result<Vec<_>, _>>()?
        .join("/");
    Ok(RepositoryContext {
        git: provisional.git,
        root,
        prefix,
    })
}

fn workspace_to_repository_path(
    context: &RepositoryContext,
    workspace_path: &str,
) -> Result<String, String> {
    safe_relative_path(workspace_path)?;
    Ok(if context.prefix.is_empty() {
        workspace_path.to_owned()
    } else {
        format!("{}/{}", context.prefix, workspace_path)
    })
}

fn strip_scope(prefix: &str, repository_path: &str) -> Result<String, String> {
    if prefix.is_empty() {
        return Ok(repository_path.to_owned());
    }
    let expected = format!("{prefix}/");
    repository_path
        .strip_prefix(&expected)
        .map(str::to_owned)
        .ok_or_else(|| "Git path is outside the selected workspace".to_owned())
}

fn scoped_change(
    old_scoped: Option<String>,
    new_scoped: Option<String>,
    status: ChangeStatus,
) -> Result<(String, Option<String>, ChangeStatus), String> {
    match (old_scoped, new_scoped, status) {
        (Some(old), Some(new), ChangeStatus::Renamed | ChangeStatus::Copied) => {
            Ok((new, Some(old), status))
        }
        (None, Some(new), _) => Ok((new, None, ChangeStatus::Added)),
        (Some(old), None, _) => Ok((old, None, ChangeStatus::Deleted)),
        (Some(_), Some(new), _) => Ok((new, None, status)),
        (None, None, _) => Err("Git path is outside the selected workspace".to_owned()),
    }
}

fn push_scope(arguments: &mut Vec<OsString>, prefix: &str) {
    arguments.push("--".into());
    arguments.push(if prefix.is_empty() { "." } else { prefix }.into());
}

fn run_git(
    context: &RepositoryContext,
    arguments: Vec<OsString>,
    fallback: &str,
) -> Result<Vec<u8>, String> {
    let mut secured = vec![
        "--no-pager".into(),
        "--no-replace-objects".into(),
        "--no-optional-locks".into(),
        "--literal-pathspecs".into(),
        "-c".into(),
        "core.fsmonitor=false".into(),
        "-c".into(),
        "color.ui=false".into(),
        "-c".into(),
        "log.showSignature=false".into(),
    ];
    secured.extend(arguments);
    let environment = [
        ("LC_ALL", OsStr::new("C")),
        ("GIT_PAGER", OsStr::new("cat")),
        ("PAGER", OsStr::new("cat")),
        ("GIT_TERMINAL_PROMPT", OsStr::new("0")),
        ("GIT_OPTIONAL_LOCKS", OsStr::new("0")),
        ("GIT_NO_LAZY_FETCH", OsStr::new("1")),
        ("GIT_LITERAL_PATHSPECS", OsStr::new("1")),
    ];
    let removed_environment = git_environment_overrides();
    run_bounded(
        &context.git,
        &secured,
        Some(&context.root),
        &environment,
        &removed_environment,
        fallback,
    )
    .map(|output| output.stdout)
}

fn git_environment_overrides() -> Vec<OsString> {
    std::env::vars_os()
        .filter_map(|(key, _)| key.to_string_lossy().starts_with("GIT_").then_some(key))
        .collect()
}

fn git_text(context: &RepositoryContext, arguments: &[&str]) -> Result<String, String> {
    run_git(
        context,
        arguments.iter().map(OsString::from).collect(),
        "Git command failed",
    )
    .and_then(|bytes| {
        String::from_utf8(bytes)
            .map(|text| text.trim().to_owned())
            .map_err(|_| "Git returned non-UTF-8 text".to_owned())
    })
}

fn git_succeeds(context: &RepositoryContext, arguments: &[&str]) -> bool {
    git_text(context, arguments).is_ok()
}

fn page_changes(changes: Vec<GitChange>, offset: usize, limit: usize) -> ChangePage {
    let end = offset.saturating_add(limit).min(changes.len());
    let page = if offset >= changes.len() {
        Vec::new()
    } else {
        changes[offset..end].to_vec()
    };
    ChangePage {
        changes: page,
        next_offset: (end < changes.len()).then_some(end),
    }
}

fn validate_page(limit: usize, maximum: usize) -> Result<(), String> {
    if limit == 0 || limit > maximum {
        Err(format!("Page size must be between 1 and {maximum}"))
    } else {
        Ok(())
    }
}

fn validate_oid(oid: &str) -> Result<(), String> {
    if (oid.len() == 40 || oid.len() == 64) && oid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err("Invalid Git object ID".to_owned())
    }
}

fn status_code(code: u8) -> Result<Option<ChangeStatus>, String> {
    match code {
        b' ' => Ok(None),
        b'A' => Ok(Some(ChangeStatus::Added)),
        b'C' => Ok(Some(ChangeStatus::Copied)),
        b'D' => Ok(Some(ChangeStatus::Deleted)),
        b'M' => Ok(Some(ChangeStatus::Modified)),
        b'R' => Ok(Some(ChangeStatus::Renamed)),
        b'T' => Ok(Some(ChangeStatus::TypeChanged)),
        b'U' => Ok(Some(ChangeStatus::Unmerged)),
        _ => Err(format!("Unsupported Git status code: {}", code as char)),
    }
}

fn status_code_to_change(code: u8) -> Result<ChangeStatus, String> {
    status_code(code)?.ok_or_else(|| "Git diff returned an empty status".to_owned())
}

fn nonzero_oid(oid: &str) -> Option<String> {
    oid.bytes().any(|byte| byte != b'0').then(|| oid.to_owned())
}

fn utf8(bytes: &[u8], field: &str) -> Result<String, String> {
    std::str::from_utf8(bytes)
        .map(str::to_owned)
        .map_err(|_| format!("{field} is not valid UTF-8"))
}

fn next_nonempty<'a>(fields: &mut impl Iterator<Item = &'a [u8]>) -> Option<&'a [u8]> {
    fields.find(|field| !field.is_empty())
}

fn next_field<'a>(
    fields: &mut impl Iterator<Item = &'a [u8]>,
    name: &str,
) -> Result<&'a [u8], String> {
    fields
        .next()
        .ok_or_else(|| format!("Git history is missing {name}"))
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path, process::Command};

    use notify::Watcher;
    use tempfile::tempdir;

    use super::*;

    fn git(cwd: &Path, arguments: &[&str]) {
        let status = Command::new("git")
            .current_dir(cwd)
            .args(arguments)
            .status()
            .expect("git should start");
        assert!(status.success(), "git {arguments:?} failed");
    }

    fn workspace(path: &Path) -> Workspace {
        let revision = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(1));
        let event_revision = std::sync::Arc::clone(&revision);
        let mut watcher = notify::recommended_watcher(move |_| {
            event_revision.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        })
        .expect("watcher");
        watcher
            .watch(path, notify::RecursiveMode::Recursive)
            .expect("watch path");
        Workspace {
            id: "test".to_owned(),
            root: fs::canonicalize(path).expect("canonical path"),
            revision,
            _watcher: Some(watcher),
            warning: None,
        }
    }

    #[test]
    fn parses_status_and_working_comparison() {
        let directory = tempdir().expect("tempdir");
        git(directory.path(), &["init", "--initial-branch=main"]);
        git(directory.path(), &["config", "user.name", "LCoder Test"]);
        git(
            directory.path(),
            &["config", "user.email", "lcoder@example.invalid"],
        );
        fs::write(directory.path().join("tracked.txt"), "before\n").expect("write tracked");
        git(directory.path(), &["add", "tracked.txt"]);
        git(directory.path(), &["commit", "-m", "initial"]);
        fs::write(directory.path().join("tracked.txt"), "after\n").expect("modify tracked");
        fs::write(directory.path().join("new file.txt"), "new\n").expect("write untracked");
        let workspace = workspace(directory.path());

        let changes = working_changes(&workspace, 0, 20).expect("changes");
        assert_eq!(changes.changes.len(), 2);
        let comparison = working_file(&workspace, "tracked.txt").expect("comparison");
        assert!(matches!(
            comparison,
            FileComparison::Text {
                original,
                modified,
                ..
            } if original == "before\n" && modified == "after\n"
        ));
    }

    #[test]
    fn reads_root_and_linear_history() {
        let directory = tempdir().expect("tempdir");
        git(directory.path(), &["init", "--initial-branch=main"]);
        git(directory.path(), &["config", "user.name", "LCoder Test"]);
        git(
            directory.path(),
            &["config", "user.email", "lcoder@example.invalid"],
        );
        fs::write(directory.path().join("src.txt"), "one\n").expect("write");
        git(directory.path(), &["add", "src.txt"]);
        git(directory.path(), &["commit", "-m", "root"]);
        fs::write(directory.path().join("src.txt"), "two\n").expect("write");
        git(directory.path(), &["commit", "-am", "second"]);
        let workspace = workspace(directory.path());

        let history = git_history(&workspace, 0, 10).expect("history");
        assert_eq!(history.commits.len(), 2);
        let changes =
            commit_changes(&workspace, &history.commits[0].oid, 0, 20).expect("commit changes");
        assert_eq!(changes.changes[0].path, "src.txt");
        let comparison =
            commit_file(&workspace, &history.commits[0].oid, "src.txt").expect("commit file");
        assert!(matches!(
            comparison,
            FileComparison::Text {
                original,
                modified,
                ..
            } if original == "one\n" && modified == "two\n"
        ));
    }

    #[test]
    fn handles_special_filenames_in_status_and_history() {
        let directory = tempdir().expect("tempdir");
        git(directory.path(), &["init", "--initial-branch=main"]);
        git(directory.path(), &["config", "user.name", "LCoder Test"]);
        git(
            directory.path(),
            &["config", "user.email", "lcoder@example.invalid"],
        );
        let filename = "tab\tand-newline\n.txt";
        fs::write(directory.path().join(filename), "before\n").expect("write special filename");
        git(directory.path(), &["add", "--", filename]);
        git(directory.path(), &["commit", "-m", "special filename"]);
        fs::write(directory.path().join(filename), "after\n").expect("modify special filename");
        let workspace = workspace(directory.path());

        let changes = working_changes(&workspace, 0, 20).expect("working changes");
        assert_eq!(changes.changes[0].path, filename);
        let comparison = working_file(&workspace, filename).expect("working comparison");
        assert!(matches!(
            comparison,
            FileComparison::Text {
                original,
                modified,
                ..
            } if original == "before\n" && modified == "after\n"
        ));

        git(
            directory.path(),
            &["commit", "-am", "modify special filename"],
        );
        let history = git_history(&workspace, 0, 10).expect("history");
        let changes =
            commit_changes(&workspace, &history.commits[0].oid, 0, 20).expect("commit changes");
        assert_eq!(changes.changes[0].path, filename);
    }

    #[test]
    fn compares_merge_commits_with_the_first_parent() {
        let directory = tempdir().expect("tempdir");
        git(directory.path(), &["init", "--initial-branch=main"]);
        git(directory.path(), &["config", "user.name", "LCoder Test"]);
        git(
            directory.path(),
            &["config", "user.email", "lcoder@example.invalid"],
        );
        fs::write(directory.path().join("base.txt"), "base\n").expect("write base");
        git(directory.path(), &["add", "."]);
        git(directory.path(), &["commit", "-m", "base"]);
        git(directory.path(), &["checkout", "-b", "feature"]);
        fs::write(directory.path().join("feature.txt"), "feature\n").expect("write feature");
        git(directory.path(), &["add", "."]);
        git(directory.path(), &["commit", "-m", "feature"]);
        git(directory.path(), &["checkout", "main"]);
        fs::write(directory.path().join("main.txt"), "main\n").expect("write main");
        git(directory.path(), &["add", "."]);
        git(directory.path(), &["commit", "-m", "main"]);
        git(
            directory.path(),
            &["merge", "--no-ff", "feature", "-m", "merge feature"],
        );
        let workspace = workspace(directory.path());

        let history = git_history(&workspace, 0, 10).expect("history");
        assert_eq!(history.commits[0].parent_oids.len(), 2);
        let changes =
            commit_changes(&workspace, &history.commits[0].oid, 0, 20).expect("merge changes");
        assert_eq!(changes.changes.len(), 1);
        assert_eq!(changes.changes[0].path, "feature.txt");
        let comparison =
            commit_file(&workspace, &history.commits[0].oid, "feature.txt").expect("merge file");
        assert!(matches!(
            comparison,
            FileComparison::Text {
                baseline,
                original,
                modified,
                ..
            } if baseline == "first parent → merge commit"
                && original.is_empty()
                && modified == "feature\n"
        ));
    }

    #[test]
    fn scopes_changes_and_history_to_a_selected_subdirectory() {
        let directory = tempdir().expect("tempdir");
        git(directory.path(), &["init", "--initial-branch=main"]);
        git(directory.path(), &["config", "user.name", "LCoder Test"]);
        git(
            directory.path(),
            &["config", "user.email", "lcoder@example.invalid"],
        );
        fs::create_dir_all(directory.path().join("inside")).expect("create inside");
        fs::create_dir_all(directory.path().join("outside")).expect("create outside");
        fs::write(directory.path().join("inside/a.txt"), "one\n").expect("write inside");
        fs::write(directory.path().join("outside/b.txt"), "one\n").expect("write outside");
        git(directory.path(), &["add", "."]);
        git(directory.path(), &["commit", "-m", "initial"]);
        fs::write(directory.path().join("inside/a.txt"), "two\n").expect("modify inside");
        fs::write(directory.path().join("outside/b.txt"), "two\n").expect("modify outside");
        let workspace = workspace(&directory.path().join("inside"));

        let summary = repository_summary(&workspace);
        assert_eq!(summary.workspace_prefix.as_deref(), Some("inside"));
        let changes = working_changes(&workspace, 0, 20).expect("scoped changes");
        assert_eq!(changes.changes.len(), 1);
        assert_eq!(changes.changes[0].path, "a.txt");
    }

    #[test]
    fn classifies_cross_scope_renames_without_exposing_outside_paths() {
        let inside = scoped_change(
            None,
            Some("destination.txt".to_owned()),
            ChangeStatus::Renamed,
        )
        .expect("rename into scope");
        assert_eq!(
            inside,
            ("destination.txt".to_owned(), None, ChangeStatus::Added)
        );

        let outside = scoped_change(Some("source.txt".to_owned()), None, ChangeStatus::Renamed)
            .expect("rename out of scope");
        assert_eq!(
            outside,
            ("source.txt".to_owned(), None, ChangeStatus::Deleted)
        );
    }
}
