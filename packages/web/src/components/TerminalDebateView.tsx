import React, { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import type { TerminalDebateState, TerminalAgentState, DebateEntry } from "../hooks/useVyiEngine.js";
import "@xterm/xterm/css/xterm.css";

// Must match TERM_COLS / TERM_ROWS in terminal-debate.ts
const PTY_COLS = 200;
const PTY_ROWS = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Single xterm.js panel — renders raw PTY bytes from one debater
// ─────────────────────────────────────────────────────────────────────────────
interface TerminalPanelProps {
  state: TerminalAgentState;
  color: string;
  role: "pro" | "con";
  sendInput: (role: "pro" | "con", data: string) => void;
}

function TerminalPanel({ state, color, role, sendInput }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const seenChunks = useRef(0);
  const [interactive, setInteractive] = useState(false);
  const inputHandlerRef = useRef<ReturnType<Terminal["onData"]> | null>(null);

  // Init xterm.js once
  useEffect(() => {
    if (!containerRef.current || termRef.current) return;
    const term = new Terminal({
      theme: {
        background: "#0d0d12",
        foreground: "#e0e0e0",
        cursor: color,
        selectionBackground: color + "33",
        black: "#000000", brightBlack: "#555555",
        red: "#ff5555", brightRed: "#ff6e6e",
        green: "#50fa7b", brightGreen: "#69ff94",
        yellow: "#f1fa8c", brightYellow: "#ffffa5",
        blue: "#bd93f9", brightBlue: "#d6acff",
        magenta: "#ff79c6", brightMagenta: "#ff92df",
        cyan: "#8be9fd", brightCyan: "#a4ffff",
        white: "#bfbfbf", brightWhite: "#ffffff",
      },
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "Menlo", monospace',
      fontSize: 12,
      lineHeight: 1.3,
      cursorBlink: true,
      scrollback: 5000,
      convertEol: true,
      cols: PTY_COLS,
      rows: PTY_ROWS,
    });
    term.open(containerRef.current);
    termRef.current = term;
    return () => {
      term.dispose();
      termRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Write new PTY chunks as they arrive
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const newChunks = state.chunks.slice(seenChunks.current);
    for (const chunk of newChunks) term.write(chunk);
    seenChunks.current = state.chunks.length;
  }, [state.chunks]);

  // Reset terminal when chunks cleared (new debate)
  useEffect(() => {
    if (state.chunks.length === 0 && seenChunks.current > 0) {
      termRef.current?.reset();
      seenChunks.current = 0;
    }
  }, [state.chunks.length]);

  // Toggle intervention mode: attach / detach onData listener
  const toggleInteractive = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    if (!interactive) {
      inputHandlerRef.current = term.onData((data) => sendInput(role, data));
      setInteractive(true);
    } else {
      inputHandlerRef.current?.dispose();
      inputHandlerRef.current = null;
      setInteractive(false);
    }
  }, [interactive, role, sendInput]);

  const statusIcon = { idle: "○", thinking: "◌", speaking: "●", done: "✓" }[state.status];

  return (
    <div
      className={`terminal-panel${interactive ? " interactive" : ""}`}
      style={{ "--panel-color": color } as React.CSSProperties}
    >
      <div className="terminal-panel-header">
        <span className={`term-status-dot ${state.status}`}>{statusIcon}</span>
        <span className="term-label">{state.label}</span>
        <span className={`term-badge ${state.status}`}>{state.status.toUpperCase()}</span>
        <button
          className={`intervene-btn${interactive ? " active" : ""}`}
          onClick={toggleInteractive}
          title={interactive ? "停止介入，恢复自动" : "手动介入终端"}
        >
          {interactive ? "🔓 介入中" : "🔒 观察"}
        </button>
      </div>
      {interactive && (
        <div className="intervene-hint">⌨ 介入模式：你的输入将直接发送到此终端</div>
      )}
      <div ref={containerRef} className="xterm-container" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Live debate log — shows clean extracted AI responses per round
// ─────────────────────────────────────────────────────────────────────────────
function DebateLog({ entries, running }: { entries: DebateEntry[]; running: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest entry
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  if (entries.length === 0 && !running) return null;

  // Group entries by round
  const rounds = new Map<number, DebateEntry[]>();
  for (const e of entries) {
    if (!rounds.has(e.round)) rounds.set(e.round, []);
    rounds.get(e.round)!.push(e);
  }

  return (
    <div className="debate-log">
      <div className="debate-log-title">📋 辩论对话记录</div>
      <div className="debate-log-body">
        {[...rounds.entries()].map(([round, items]) => (
          <div key={round} className="debate-round-block">
            <div className="debate-round-label">— 第 {round} 轮 —</div>
            {items.map((e, i) => (
              <div key={i} className={`debate-entry ${e.role}`}>
                <div className="debate-entry-header">{e.label}</div>
                <div className="debate-entry-text">{e.text}</div>
              </div>
            ))}
          </div>
        ))}
        {running && <div className="debate-log-thinking">⏳ 等待回应中…</div>}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level view: two side-by-side terminal panels + live debate log
// ─────────────────────────────────────────────────────────────────────────────
interface Props {
  state: TerminalDebateState;
  sendInput: (role: "pro" | "con", data: string) => void;
  proRoleCtx: string;
  conRoleCtx: string;
  onProRoleCtxChange: (v: string) => void;
  onConRoleCtxChange: (v: string) => void;
  isRunning: boolean;
}

export function TerminalDebateView({ state, sendInput, proRoleCtx, conRoleCtx, onProRoleCtxChange, onConRoleCtxChange, isRunning }: Props) {
  const [proSettingsOpen, setProSettingsOpen] = useState(false);
  const [conSettingsOpen, setConSettingsOpen] = useState(false);

  const roundLabel =
    state.round === 0 && state.running
      ? "⚡ 初始化 AI 终端…"
      : state.round === 0
      ? "等待开始…"
      : `⚡ 第 ${state.round} / ${state.totalRounds} 轮`;

  const isDone = !state.running && state.debateLog.length > 0;

  return (
    <div className="terminal-debate-view">
      <div className="terminal-round-bar">
        <span className={`round-tag ${isDone ? "done" : state.running ? "" : "idle"}`}>
          {isDone ? "✓ 辩论结束" : roundLabel}
        </span>
      </div>

      <div className="terminal-main-layout">
        {/* Left: terminal panels with settings areas */}
        <div className="terminal-panels-col">
          <div className="terminal-panels-row">
            {/* PRO panel */}
            <div className="terminal-panel-wrapper">
              <div className="agent-settings-bar">
                <button
                  className="settings-toggle"
                  onClick={() => setProSettingsOpen((v) => !v)}
                  disabled={isRunning}
                  title={isRunning ? "辩论进行中，无法修改提示词" : "编辑正方提示词"}
                >
                  ⚙ 正方提示词 {proSettingsOpen ? "▲" : "▼"}
                </button>
                {isRunning && <span className="settings-locked">🔒 运行中</span>}
              </div>
              {proSettingsOpen && (
                <div className="agent-settings-panel">
                  <textarea
                    className="agent-prompt-textarea"
                    value={proRoleCtx}
                    onChange={(e) => onProRoleCtxChange(e.target.value)}
                    disabled={isRunning}
                    rows={4}
                    placeholder="正方角色系统提示词…"
                  />
                  <div className="settings-hint">
                    💡 建议末尾包含：将你的回答包裹在 &lt;answer&gt; 和 &lt;/answer&gt; 标签之间
                  </div>
                </div>
              )}
              <TerminalPanel state={state.pro} color="#00ff88" role="pro" sendInput={sendInput} />
            </div>

            <div className="handoff-divider">
              <span className="handoff-vs">VS</span>
              {state.running && <div className="handoff-pulse" />}
            </div>

            {/* CON panel */}
            <div className="terminal-panel-wrapper">
              <div className="agent-settings-bar">
                <button
                  className="settings-toggle"
                  onClick={() => setConSettingsOpen((v) => !v)}
                  disabled={isRunning}
                  title={isRunning ? "辩论进行中，无法修改提示词" : "编辑反方提示词"}
                >
                  ⚙ 反方提示词 {conSettingsOpen ? "▲" : "▼"}
                </button>
                {isRunning && <span className="settings-locked">🔒 运行中</span>}
              </div>
              {conSettingsOpen && (
                <div className="agent-settings-panel">
                  <textarea
                    className="agent-prompt-textarea"
                    value={conRoleCtx}
                    onChange={(e) => onConRoleCtxChange(e.target.value)}
                    disabled={isRunning}
                    rows={4}
                    placeholder="反方角色系统提示词…"
                  />
                  <div className="settings-hint">
                    💡 建议末尾包含：将你的回答包裹在 &lt;answer&gt; 和 &lt;/answer&gt; 标签之间
                  </div>
                </div>
              )}
              <TerminalPanel state={state.con} color="#ff6b6b" role="con" sendInput={sendInput} />
            </div>
          </div>
        </div>

        {/* Right: live clean debate log */}
        <DebateLog entries={state.debateLog} running={state.running} />
      </div>
    </div>
  );
}
