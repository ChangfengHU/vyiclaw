import React from "react";
import type { AgentState } from "../hooks/useVyiEngine.js";

interface Props {
  agentId: string;
  status: AgentState["status"];
}

export function AgentAvatar({ agentId, status }: Props) {
  return (
    <div className={`avatar avatar-${agentId} avatar-${status}`} aria-hidden="true">
      {agentId === "main" && <MainAvatar status={status} />}
      {agentId === "pro" && <ProAvatar status={status} />}
      {agentId === "con" && <ConAvatar status={status} />}
      {agentId === "pm" && <PmAvatar status={status} />}
      {agentId === "dev" && <DevAvatar status={status} />}
      {agentId === "qa" && <QaAvatar status={status} />}
    </div>
  );
}

function MainAvatar({ status }: { status: string }) {
  return (
    <svg viewBox="0 0 100 100" className={`svg-avatar main-avatar anim-${status}`}>
      {/* Hexagonal brain/eye shape */}
      <polygon points="50,10 85,30 85,70 50,90 15,70 15,30"
        className="hex-outer" />
      <polygon points="50,20 76,35 76,65 50,80 24,65 24,35"
        className="hex-inner" />
      {/* Central eye */}
      <circle cx="50" cy="50" r="14" className="eye-outer" />
      <circle cx="50" cy="50" r="8" className="eye-mid" />
      <circle cx="50" cy="50" r="4" className="eye-core" />
      {/* Neural lines */}
      <line x1="50" y1="20" x2="50" y2="36" className="neural-line" />
      <line x1="76" y1="35" x2="64" y2="42" className="neural-line" />
      <line x1="76" y1="65" x2="64" y2="58" className="neural-line" />
      <line x1="50" y1="80" x2="50" y2="64" className="neural-line" />
      <line x1="24" y1="65" x2="36" y2="58" className="neural-line" />
      <line x1="24" y1="35" x2="36" y2="42" className="neural-line" />
    </svg>
  );
}

function ProAvatar({ status }: { status: string }) {
  return (
    <svg viewBox="0 0 100 100" className={`svg-avatar pro-avatar anim-${status}`}>
      {/* Upward sword/triangle */}
      <polygon points="50,5 62,75 50,68 38,75" className="sword-blade" />
      {/* Guard */}
      <rect x="25" y="72" width="50" height="8" rx="3" className="sword-guard" />
      {/* Handle */}
      <rect x="44" y="80" width="12" height="18" rx="3" className="sword-handle" />
      {/* Glow edge */}
      <line x1="50" y1="5" x2="38" y2="75" className="sword-edge" />
      <line x1="50" y1="5" x2="62" y2="75" className="sword-edge" />
    </svg>
  );
}

function ConAvatar({ status }: { status: string }) {
  return (
    <svg viewBox="0 0 100 100" className={`svg-avatar con-avatar anim-${status}`}>
      {/* Shield shape */}
      <path d="M50,8 L85,22 L85,55 C85,75 68,88 50,96 C32,88 15,75 15,55 L15,22 Z"
        className="shield-outer" />
      <path d="M50,16 L78,28 L78,54 C78,71 63,82 50,89 C37,82 22,71 22,54 L22,28 Z"
        className="shield-inner" />
      {/* Cross emblem */}
      <rect x="46" y="32" width="8" height="30" rx="2" className="shield-cross" />
      <rect x="33" y="45" width="34" height="8" rx="2" className="shield-cross" />
    </svg>
  );
}

function PmAvatar({ status }: { status: string }) {
  return (
    <svg viewBox="0 0 100 100" className={`svg-avatar pm-avatar anim-${status}`}>
      {/* Document/scroll */}
      <rect x="20" y="10" width="60" height="75" rx="4" className="doc-bg" />
      <rect x="20" y="10" width="60" height="15" rx="4" className="doc-header" />
      {/* Lines */}
      <line x1="30" y1="38" x2="70" y2="38" className="doc-line" />
      <line x1="30" y1="48" x2="70" y2="48" className="doc-line" />
      <line x1="30" y1="58" x2="60" y2="58" className="doc-line" />
      <line x1="30" y1="68" x2="65" y2="68" className="doc-line" />
      {/* Stamp circle */}
      <circle cx="68" cy="78" r="10" className="doc-stamp" />
      <text x="68" y="82" textAnchor="middle" className="doc-stamp-text">✓</text>
    </svg>
  );
}

function DevAvatar({ status }: { status: string }) {
  return (
    <svg viewBox="0 0 100 100" className={`svg-avatar dev-avatar anim-${status}`}>
      {/* Terminal box */}
      <rect x="10" y="15" width="80" height="65" rx="5" className="term-bg" />
      <rect x="10" y="15" width="80" height="15" rx="5" className="term-header" />
      {/* Terminal buttons */}
      <circle cx="24" cy="22" r="3" className="term-btn-red" />
      <circle cx="34" cy="22" r="3" className="term-btn-yellow" />
      <circle cx="44" cy="22" r="3" className="term-btn-green" />
      {/* Code lines */}
      <text x="17" y="47" className="term-line term-line-1">&gt; init()</text>
      <text x="17" y="59" className="term-line term-line-2">$ build</text>
      <text x="17" y="71" className="term-line term-cursor">█</text>
    </svg>
  );
}

function QaAvatar({ status }: { status: string }) {
  return (
    <svg viewBox="0 0 100 100" className={`svg-avatar qa-avatar anim-${status}`}>
      {/* Magnifying glass */}
      <circle cx="42" cy="42" r="28" className="lens-outer" />
      <circle cx="42" cy="42" r="20" className="lens-inner" />
      {/* Handle */}
      <line x1="63" y1="63" x2="88" y2="88" className="lens-handle" strokeWidth="8" strokeLinecap="round" />
      {/* Check mark inside lens */}
      <polyline points="32,42 40,52 56,32" className="lens-check" />
    </svg>
  );
}
