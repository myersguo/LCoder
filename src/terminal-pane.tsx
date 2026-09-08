import "@xterm/xterm/css/xterm.css";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
  Bot,
  ChevronDown,
  Circle,
  Play,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  TerminalSquare
} from "lucide-react";

import {
  acknowledgeTerminal,
  chooseTerminalExecutable,
  readTerminalProfiles,
  resizeTerminal,
  setWorkspaceTrusted,
  startTerminal,
  stopTerminal,
  writeTerminal
} from "./api";
import { buildAiCodePrompt } from "./explain-selection";
import type {
  AiCodeRequest,
  TerminalInfo,
  TerminalProfile,
  WorkspaceSummary
} from "./types";

const LIGHT_TERMINAL_THEME = {
  background: "#ffffff",
  black: "#20201e",
  blue: "#356fd6",
  brightBlack: "#777772",
  brightBlue: "#5b88dd",
  brightCyan: "#348b86",
  brightGreen: "#4e8368",
  brightMagenta: "#7963c7",
  brightRed: "#d05d51",
  brightWhite: "#ffffff",
  brightYellow: "#a97925",
  cursor: "#356fd6",
  cyan: "#287a76",
  foreground: "#20201e",
  green: "#387258",
  magenta: "#6b55b7",
  red: "#c4473a",
  selectionBackground: "#c9d9f2",
  white: "#ececea",
  yellow: "#966817"
};

const DARK_TERMINAL_THEME = {
  background: "#1d1e20",
  black: "#161719",
  blue: "#7aa2f7",
  brightBlack: "#73777d",
  brightBlue: "#9ab7ff",
  brightCyan: "#9fdbcf",
  brightGreen: "#b6d887",
  brightMagenta: "#d7a8de",
  brightRed: "#ff8f7f",
  brightWhite: "#ffffff",
  brightYellow: "#ffd08a",
  cursor: "#78a5f5",
  cyan: "#72c7b7",
  foreground: "#e4e7ec",
  green: "#9ec66f",
  magenta: "#be88c8",
  red: "#e06c5f",
  selectionBackground: "#35527a99",
  white: "#d5d8dd",
  yellow: "#d7a95c"
};

interface TerminalPaneProps {
  aiCodeRequest: AiCodeRequest | null;
  onRunningChange: (running: boolean) => void;
  onWorkspaceChange: (workspace: WorkspaceSummary) => void;
  theme: "dark" | "light";
  workspace: WorkspaceSummary | null;
}

export const TerminalPane = memo(function TerminalPane({
  aiCodeRequest,
  onRunningChange,
  onWorkspaceChange,
  theme,
  workspace
}: TerminalPaneProps) {
  const [profiles, setProfiles] = useState<TerminalProfile[]>([]);
  const [profileId, setProfileId] = useState("codex");
  const [session, setSession] = useState<TerminalInfo | null>(null);
  const [status, setStatus] = useState("IDLE");
  const [error, setError] = useState<string | null>(null);
  const [trustOpen, setTrustOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [pendingAiRequest, setPendingAiRequest] = useState<AiCodeRequest | null>(null);
  const [aiCodeContext, setAiCodeContext] = useState<{
    request: AiCodeRequest;
    status: "queued" | "sent";
  } | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const sessionId = useRef<string | null>(null);
  const launchGeneration = useRef(0);
  const handledAiRequestId = useRef(0);
  const sendingAiRequestId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void readTerminalProfiles()
      .then((items) => {
        if (cancelled) return;
        setProfiles(items);
        if (!items.some((profile) => profile.id === profileId && profile.available)) {
          setProfileId(items.find((profile) => profile.available)?.id ?? "shell");
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  useEffect(() => {
    if (!container.current || terminal.current) return;
    const instance = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: '"Berkeley Mono", "SFMono-Regular", Menlo, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.3,
      scrollback: 5000,
      theme: LIGHT_TERMINAL_THEME
    });
    const fit = new FitAddon();
    instance.loadAddon(fit);
    instance.open(container.current);
    fit.fit();
    instance.writeln("\x1b[34mLCoder terminal\x1b[0m");
    instance.writeln("Choose a runtime, trust the workspace, then start.");
    const input = instance.onData((data) => {
      if (sessionId.current) {
        void writeTerminal(sessionId.current, new TextEncoder().encode(data)).catch((reason) => {
          setError(reason instanceof Error ? reason.message : String(reason));
        });
      }
    });
    const resize = instance.onResize(({ cols, rows }) => {
      if (sessionId.current) {
        void resizeTerminal(sessionId.current, rows, cols).catch(() => undefined);
      }
    });
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(container.current);
    terminal.current = instance;
    fitAddon.current = fit;
    return () => {
      observer.disconnect();
      input.dispose();
      resize.dispose();
      instance.dispose();
      terminal.current = null;
      fitAddon.current = null;
      launchGeneration.current += 1;
      if (sessionId.current) void stopTerminal(sessionId.current).catch(() => undefined);
      onRunningChange(false);
    };
  }, [onRunningChange]);

  useEffect(() => {
    if (terminal.current) {
      terminal.current.options.theme =
        theme === "dark" ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME;
    }
  }, [theme]);

  useEffect(() => {
    if (session && workspace && sessionId.current && status === "RUNNING") {
      // The parent guards workspace switching. This effect deliberately keeps the PTY mounted.
    }
  }, [session, status, workspace]);

  const selectedProfile =
    profiles.find((profile) => profile.id === profileId) ??
    profiles.find((profile) => profile.available);

  const sendPrompt = useCallback(async (info: TerminalInfo, request: AiCodeRequest) => {
    if (!terminal.current || sendingAiRequestId.current === request.id) return;
    sendingAiRequestId.current = request.id;
    try {
      terminal.current.scrollToBottom();
      terminal.current.focus();
      const input = `\u001b[200~${buildAiCodePrompt(request.action, request.selection)}\u001b[201~\r`;
      await writeTerminal(info.id, new TextEncoder().encode(input));
      setPendingAiRequest(null);
      setAiCodeContext({ request, status: "sent" });
    } catch (reason) {
      sendingAiRequestId.current = 0;
      throw reason;
    }
  }, []);

  const launchFor = useCallback(async (targetWorkspace: WorkspaceSummary) => {
    if (!selectedProfile?.available || !terminal.current) {
      setError(`${selectedProfile?.label ?? "Terminal profile"} is unavailable.`);
      return;
    }
    onRunningChange(true);
    setStatus("STARTING");
    setError(null);
    terminal.current.clear();
    const generation = ++launchGeneration.current;
    let exitedBeforeStartResolved = false;
    try {
      const info = await startTerminal(
        targetWorkspace.id,
        selectedProfile.id,
        terminal.current.rows,
        terminal.current.cols,
        (event) => {
          if (generation !== launchGeneration.current) return;
          if (event.type === "output") {
            const acknowledge = () => {
              void acknowledgeTerminal(event.sessionId, event.data.length).catch(
                () => undefined
              );
            };
            if (terminal.current) {
              terminal.current.write(Uint8Array.from(event.data), acknowledge);
            } else {
              acknowledge();
            }
          } else if (event.type === "exit") {
            exitedBeforeStartResolved = true;
            terminal.current?.writeln(
              `\r\n\x1b[38;5;245m[process exited ${event.signal ?? event.code}]\x1b[0m`
            );
            sessionId.current = null;
            setSession(null);
            setStatus("EXITED");
            onRunningChange(false);
          } else {
            terminal.current?.writeln(`\r\n\x1b[31m${event.message}\x1b[0m`);
            setError(event.message);
          }
        }
      );
      if (generation !== launchGeneration.current) {
        void stopTerminal(info.id).catch(() => undefined);
        return;
      }
      if (exitedBeforeStartResolved) {
        return;
      }
      sessionId.current = info.id;
      setSession(info);
      setStatus("RUNNING");
      onRunningChange(true);
      terminal.current.focus();
    } catch (reason) {
      if (generation !== launchGeneration.current) return;
      launchGeneration.current += 1;
      onRunningChange(false);
      setStatus("ERROR");
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [onRunningChange, selectedProfile]);

  const launch = async () => {
    if (!workspace) {
      setError("Open a workspace before starting a terminal.");
      return;
    }
    if (!workspace.trusted) {
      setTrustOpen(true);
      return;
    }
    await launchFor(workspace);
  };

  useEffect(() => {
    if (!aiCodeRequest || aiCodeRequest.id <= handledAiRequestId.current) return;
    handledAiRequestId.current = aiCodeRequest.id;
    setPendingAiRequest(aiCodeRequest);
    setAiCodeContext({ request: aiCodeRequest, status: "queued" });
    setError(null);
  }, [aiCodeRequest]);

  useEffect(() => {
    if (!pendingAiRequest) return;
    if (!workspace) {
      setError("Open a workspace before using an AI code action.");
      return;
    }

    if (session && session.profileId !== "shell") {
      void sendPrompt(session, pendingAiRequest).catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
      return;
    }

    if (session?.profileId === "shell") {
      setError("Stop the Shell terminal, choose an AI runtime, then use the code action.");
      return;
    }

    const selectedAiProfile = profiles.find(
      (profile) => profile.id === profileId && profile.available && profile.id !== "shell"
    );
    const aiProfile =
      selectedAiProfile ??
      profiles.find((profile) => profile.available && profile.id !== "shell");
    if (!aiProfile) {
      setError("Install or configure Codex, Claude Code, or TraeX to use AI code actions.");
      return;
    }
    if (profileId !== aiProfile.id) {
      setProfileId(aiProfile.id);
      return;
    }
    if (!workspace.trusted) {
      setTrustOpen(true);
      return;
    }
    void launchFor(workspace);
  }, [
    launchFor,
    pendingAiRequest,
    profileId,
    profiles,
    sendPrompt,
    session,
    workspace
  ]);

  const stop = async () => {
    if (!sessionId.current) return;
    const id = sessionId.current;
    launchGeneration.current += 1;
    sessionId.current = null;
    setStatus("STOPPING");
    try {
      await stopTerminal(id);
      setSession(null);
      setStatus("EXITED");
      onRunningChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus("ERROR");
    }
  };

  return (
    <aside className="terminal-pane" aria-label="AI terminal">
      <header className="terminal-header">
        <div>
          <span className="panel-kicker">AI TERMINAL</span>
          <strong>{selectedProfile?.label ?? "Runtime"}</strong>
        </div>
        <div className="terminal-status" data-status={status.toLowerCase()}>
          <Circle fill="currentColor" size={7} />
          {status}
        </div>
      </header>

      <div className="terminal-controls">
        <div className="profile-picker">
          <button
            aria-expanded={profileMenuOpen}
            className="profile-trigger"
            onClick={() => setProfileMenuOpen((value) => !value)}
            type="button"
          >
            {selectedProfile?.id === "shell" ? <TerminalSquare size={14} /> : <Bot size={14} />}
            <span>
              <strong>{selectedProfile?.label ?? "Select runtime"}</strong>
              <small>
                {selectedProfile?.version ??
                  (selectedProfile?.available ? "Available" : "Not found")}
              </small>
            </span>
            <ChevronDown size={13} />
          </button>
          {profileMenuOpen ? (
            <div className="profile-menu">
              {profiles.map((profile) => (
                <button
                  className={profile.id === profileId ? "active" : ""}
                  disabled={!profile.available || Boolean(session)}
                  key={profile.id}
                  onClick={() => {
                    setProfileId(profile.id);
                    setProfileMenuOpen(false);
                  }}
                  type="button"
                >
                  <span>{profile.label}</span>
                  <small>{profile.version ?? (profile.available ? "Available" : "Not installed")}</small>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          aria-label="Choose terminal executable"
          className="icon-button"
          disabled={Boolean(session)}
          onClick={() => {
            if (!selectedProfile) return;
            void chooseTerminalExecutable(selectedProfile.id)
              .then((items) => {
                if (items) setProfiles(items);
              })
              .catch((reason: unknown) => {
                setError(reason instanceof Error ? reason.message : String(reason));
              });
          }}
          title="Choose executable"
          type="button"
        >
          <Settings2 size={14} />
        </button>
        {session ? (
          <button className="terminal-action stop" onClick={() => void stop()} type="button">
            <Square fill="currentColor" size={10} /> Stop
          </button>
        ) : (
          <button
            className="terminal-action"
            disabled={!workspace || !selectedProfile?.available || status === "STARTING"}
            onClick={() => void launch()}
            type="button"
          >
            <Play fill="currentColor" size={10} /> Start
          </button>
        )}
      </div>

      <div className="terminal-cwd" title={workspace?.path}>
        <span>$</span>
        <code>{workspace?.path ?? "No workspace selected"}</code>
      </div>

      {aiCodeContext ? (
        <div className="terminal-context" data-status={aiCodeContext.status}>
          <Sparkles size={13} />
          <span>
            {aiCodeContext.request.action === "review" ? "Review" : "Explanation"}{" "}
            {aiCodeContext.status === "sent" ? "sent" : "queued"} ·{" "}
            <strong>{aiCodeContext.request.selection.path}</strong>
            <small>
              {aiCodeContext.request.selection.scope === "file"
                ? "Entire file"
                : `L${aiCodeContext.request.selection.startLine}–L${aiCodeContext.request.selection.endLine}`}
            </small>
          </span>
        </div>
      ) : null}
      {error ? <div className="terminal-error">{error}</div> : null}
      <div className="terminal-viewport" ref={container} />

      <footer className="terminal-footer">
        <span>{session ? "PTY CONNECTED" : "NO ACTIVE PROCESS"}</span>
        <span>{workspace?.trusted ? "TRUSTED WORKSPACE" : "READ-ONLY UNTIL TRUSTED"}</span>
      </footer>

      {trustOpen && workspace ? (
        <div className="modal-backdrop" role="presentation">
          <section aria-labelledby="trust-title" aria-modal="true" className="trust-dialog" role="dialog">
            <div className="trust-icon">
              <ShieldCheck size={22} />
            </div>
            <p className="eyebrow">EXECUTION BOUNDARY</p>
            <h2 id="trust-title">Trust this workspace?</h2>
            <p>
              Starting {selectedProfile?.label} allows it to execute commands and change files
              inside <strong>{workspace.name}</strong>. Only trust code you understand.
            </p>
            <code>{workspace.path}</code>
            <div className="dialog-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  setTrustOpen(false);
                  setPendingAiRequest(null);
                  setAiCodeContext(null);
                }}
                type="button"
              >
                Keep read-only
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  void setWorkspaceTrusted(workspace.id, true).then((updated) => {
                    onWorkspaceChange(updated);
                    setTrustOpen(false);
                    if (!pendingAiRequest) void launchFor(updated);
                  }).catch((reason: unknown) => {
                    setError(reason instanceof Error ? reason.message : String(reason));
                  });
                }}
                type="button"
              >
                Trust & continue
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </aside>
  );
});
