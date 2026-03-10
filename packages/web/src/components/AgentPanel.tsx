import React, { useRef, useEffect } from "react";
import { AgentAvatar } from "./AgentAvatar.js";
import { MessageBubble } from "./MessageBubble.js";
import type { AgentState } from "../hooks/useVyiEngine.js";

interface Props {
  agentId: string;
  state?: AgentState;
}

const ROLE_LABELS: Record<string, string> = {
  main: "Orchestrator",
  pro: "Advocate",
  con: "Critic",
  pm: "Product Manager",
  dev: "Engineer",
  qa: "QA Engineer",
};

const AGENT_ICONS: Record<string, string> = {
  main: "🧠",
  pro: "⚔️",
  con: "🛡️",
  pm: "📋",
  dev: "💻",
  qa: "🔍",
};

export function AgentPanel({ agentId, state }: Props) {
  const status = state?.status ?? "idle";
  const messages = state?.messages ?? [];
  const currentToken = state?.currentToken ?? "";
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages, currentToken]);

  const statusDotClass =
    status === "thinking" ? "dot-thinking" :
    status === "speaking" ? "dot-speaking" :
    status === "done" ? "dot-done" : "dot-idle";

  const statusText =
    status === "thinking" ? "Thinking" :
    status === "speaking" ? "Speaking" :
    status === "done" ? "Done" : "Idle";

  return (
    <div className={`agent-panel panel-${agentId} panel-status-${status}`}>
      <div className="panel-header">
        <span className="panel-icon">{AGENT_ICONS[agentId] ?? "🤖"}</span>
        <div className="panel-title-group">
          <span className="panel-name">{state?.name ?? agentId.toUpperCase()}</span>
          <span className="panel-role">{ROLE_LABELS[agentId] ?? agentId}</span>
        </div>
        <div className={`status-dot ${statusDotClass}`} />
      </div>

      <div className="avatar-zone">
        <AgentAvatar agentId={agentId} status={status} />
      </div>

      <div className="status-text">
        <span className="status-label">{statusText}</span>
        {(status === "thinking" || status === "speaking") && (
          <span className="status-dots">
            <span className="dot1">.</span>
            <span className="dot2">.</span>
            <span className="dot3">.</span>
          </span>
        )}
      </div>

      <div className="chat-log" ref={chatRef}>
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {currentToken && (
          <div className="message-bubble streaming">
            <span className="streaming-text">{currentToken}</span>
            <span className="streaming-cursor">▊</span>
          </div>
        )}
        {messages.length === 0 && !currentToken && (
          <div className="chat-empty">No messages yet</div>
        )}
      </div>
    </div>
  );
}
