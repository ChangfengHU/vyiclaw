import React, { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { TerminalDebateState, TerminalAgentState } from "../hooks/useVyiEngine.js";
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
      // Fixed columns to match PTY — prevents line-wrapping artifacts
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

  // Attach / detach keystroke forwarding when interactive mode changes
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (interactive) {
      inputHandlerRef.current = term.onData((data) => sendInput(role, data));
      term.focus();
    } else {
      inputHandlerRef.current?.dispose();
      inputHandlerRef.current = null;
    }
    return () => {
      inputHandlerRef.current?.dispose();
      inputHandlerRef.current = null;
    };
  }, [interactive, role, sendInput]);

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
      setInteractive(false);
    }
  }, [state.chunks.length]);

  const statusIcon = { idle: "○", thinking: "◌", speaking: "●", done: "✓" }[state.status];

  const toggleInteractive = useCallback(() => setInteractive((v) => !v), []);

  return (
    <div
      className={`terminal-panel ${interactive ? "interactive" : ""}`}
      style={{ "--panel-color": interactive ? "#ffcc00" : color } as React.CSSProperties}
    >
      <div className="terminal-panel-header">
        <span className={`term-status-dot ${state.status}`}>{statusIcon}</span>
        <span className="term-label">{state.label}</span>
        <span className={`term-badge ${state.status}`}>{state.status.toUpperCase()}</span>
        <button
          className={`intervene-btn ${interactive ? "active" : ""}`}
          onClick={toggleInteractive}
          title={interactive ? "点击退出介入模式" : "点击介入 — 直接向此 CLI 输入"}
        >
          {interactive ? "⌨ 介入中" : "🔒 观察"}
        </button>
      </div>
      {interactive && (
        <div className="intervene-hint">
          ⌨ 介入模式：点击终端后直接输入，不影响自动辩论流程
        </div>
      )}
      {/* Horizontally scrollable so the 200-col PTY renders without wrapping */}
      <div ref={containerRef} className="xterm-container" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level view: two side-by-side terminal panels
// ─────────────────────────────────────────────────────────────────────────────
interface Props {
  state: TerminalDebateState;
  sendInput: (role: "pro" | "con", data: string) => void;
}

export function TerminalDebateView({ state, sendInput }: Props) {
  const roundLabel =
    state.round === 0 && state.running
      ? "⚡ Initializing CLIs…"
      : state.round === 0
      ? "等待开始…"
      : `⚡ Round ${state.round} / ${state.totalRounds}`;

  return (
    <div className="terminal-debate-view">
      <div className="terminal-round-bar">
        <span className={`round-tag ${state.summary ? "done" : state.running ? "" : "idle"}`}>
          {state.summary ? "✓ 辩论结束" : roundLabel}
        </span>
      </div>

      <div className="terminal-panels-row">
        <TerminalPanel state={state.pro} color="#00ff88" role="pro" sendInput={sendInput} />
        <div className="handoff-divider">
          <span className="handoff-vs">VS</span>
          {state.running && <div className="handoff-pulse" />}
        </div>
        <TerminalPanel state={state.con} color="#ff6b6b" role="con" sendInput={sendInput} />
      </div>

      {state.summary && (
        <div className="debate-summary">
          <div className="summary-title">📋 辩论记录</div>
          <pre className="summary-body">{state.summary}</pre>
        </div>
      )}
    </div>
  );
}

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { TerminalDebateState, TerminalAgentState } from "../hooks/useVyiEngine.js";
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
}

function TerminalPanel({ state, color }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const seenChunks = useRef(0);

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
      // Fixed columns to match PTY — prevents line-wrapping artifacts
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

  const statusIcon = { idle: "○", thinking: "◌", speaking: "●", done: "✓" }[state.status];

  return (
    <div className="terminal-panel" style={{ "--panel-color": color } as React.CSSProperties}>
      <div className="terminal-panel-header">
        <span className={`term-status-dot ${state.status}`}>{statusIcon}</span>
        <span className="term-label">{state.label}</span>
        <span className={`term-badge ${state.status}`}>{state.status.toUpperCase()}</span>
      </div>
      {/* Horizontally scrollable so the 200-col PTY renders without wrapping */}
      <div ref={containerRef} className="xterm-container" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level view: two side-by-side terminal panels
// ─────────────────────────────────────────────────────────────────────────────
interface Props {
  state: TerminalDebateState;
}

export function TerminalDebateView({ state }: Props) {
  const roundLabel =
    state.round === 0 && state.running
      ? "⚡ Initializing CLIs…"
      : state.round === 0
      ? "等待开始…"
      : `⚡ Round ${state.round} / ${state.totalRounds}`;

  return (
    <div className="terminal-debate-view">
      <div className="terminal-round-bar">
        <span className={`round-tag ${state.summary ? "done" : state.running ? "" : "idle"}`}>
          {state.summary ? "✓ 辩论结束" : roundLabel}
        </span>
      </div>

      <div className="terminal-panels-row">
        <TerminalPanel state={state.pro} color="#00ff88" />
        <div className="handoff-divider">
          <span className="handoff-vs">VS</span>
          {state.running && <div className="handoff-pulse" />}
        </div>
        <TerminalPanel state={state.con} color="#ff6b6b" />
      </div>

      {state.summary && (
        <div className="debate-summary">
          <div className="summary-title">📋 辩论记录</div>
          <pre className="summary-body">{state.summary}</pre>
        </div>
      )}
    </div>
  );
}

