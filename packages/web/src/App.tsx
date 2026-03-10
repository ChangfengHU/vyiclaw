import React, { useState } from "react";
import { AgentPanel } from "./components/AgentPanel.js";
import { ModeSelector } from "./components/ModeSelector.js";
import { HandoffArrow } from "./components/HandoffArrow.js";
import { TerminalDebateView } from "./components/TerminalDebateView.js";
import { useVyiEngine } from "./hooks/useVyiEngine.js";

export type Mode = "debate" | "dev" | "custom" | "terminal_debate";

export default function App() {
  const [mode, setMode] = useState<Mode>("debate");
  const [input, setInput] = useState("AI是否会导致人类灭绝");
  const { agentStates, handoffs, startDebate, startDev, startTerminalDebate, isRunning, connected, terminalState } = useVyiEngine();

  const debateAgents = ["pro", "con", "main"];
  const devAgents = ["pm", "dev", "qa"];
  const customAgents = ["main", "pro", "con", "pm", "dev", "qa"];

  const visibleAgentIds =
    mode === "debate" ? debateAgents : mode === "dev" ? devAgents : customAgents;

  function handleModeChange(newMode: Mode) {
    setMode(newMode);
    if (newMode === "debate") setInput("AI是否会导致人类灭绝");
    else if (newMode === "terminal_debate") setInput("AI是否会导致人类灭绝");
    else if (newMode === "dev") setInput("实现一个简单的 REST API 服务器");
    else setInput("");
  }

  function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isRunning) return;
    if (mode === "debate") startDebate(input.trim());
    else if (mode === "dev") startDev(input.trim());
    else if (mode === "terminal_debate") startTerminalDebate(input.trim());
    else startDebate(input.trim());
  }

  // Find active handoffs for arrow rendering
  const activeHandoffs = handoffs.filter((h) => h.active);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="logo-icon">⚡</span>
          <span className="logo-text">VYICLAW</span>
        </div>
        <ModeSelector mode={mode} onModeChange={handleModeChange} />
        <div className="topbar-status">
          <span className={`conn-dot ${connected ? "connected" : "disconnected"}`} />
          <span className="conn-label">{connected ? "Connected" : "Offline"}</span>
        </div>
      </header>

      <main className="panels-area">
        {mode === "terminal_debate" ? (
          <TerminalDebateView state={terminalState} />
        ) : (
          <>
            {visibleAgentIds.map((agentId) => {
              const state = agentStates[agentId];
              return (
                <AgentPanel
                  key={agentId}
                  agentId={agentId}
                  state={state}
                />
              );
            })}
            {/* Handoff arrows overlay */}
            {activeHandoffs.map((h, i) => (
              <HandoffArrow key={i} from={h.from} to={h.to} agentIds={visibleAgentIds} />
            ))}
          </>
        )}
      </main>

      <footer className="input-bar">
        <form onSubmit={handleStart} className="input-form">
          <input
            className="topic-input"
            type="text"
            placeholder={
              mode === "debate"
                ? "输入辩题…"
                : mode === "dev"
                ? "输入开发任务…"
                : "输入指令…"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isRunning}
          />
          <button
            className={`start-btn ${isRunning ? "running" : ""}`}
            type="submit"
            disabled={isRunning || !input.trim()}
          >
            {isRunning ? "⏳ Running…" : "▶ START"}
          </button>
        </form>
      </footer>
    </div>
  );
}
