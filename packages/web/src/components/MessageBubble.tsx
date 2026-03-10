import React from "react";
import type { Message } from "../hooks/useVyiEngine.js";

interface Props {
  message: Message;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";

  return (
    <div className={`message-bubble ${isUser ? "msg-user" : "msg-assistant"}`}>
      <div className="msg-content">{message.content}</div>
      {message.timestamp && (
        <div className="msg-time">
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
