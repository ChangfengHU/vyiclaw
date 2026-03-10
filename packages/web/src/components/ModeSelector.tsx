import React from "react";
import type { Mode } from "../App.js";

interface Props {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
}

const MODES: { id: Mode; label: string; icon: string }[] = [
  { id: "debate", label: "DEBATE", icon: "⚔️" },
  { id: "terminal_debate", label: "TERMINAL", icon: "⚡" },
  { id: "dev", label: "DEV TEAM", icon: "💻" },
  { id: "custom", label: "CUSTOM", icon: "⚙️" },
];

export function ModeSelector({ mode, onModeChange }: Props) {
  return (
    <nav className="mode-selector">
      {MODES.map((m) => (
        <button
          key={m.id}
          className={`mode-btn ${mode === m.id ? "mode-active" : ""}`}
          onClick={() => onModeChange(m.id)}
        >
          <span className="mode-icon">{m.icon}</span>
          <span className="mode-label">{m.label}</span>
        </button>
      ))}
    </nav>
  );
}
