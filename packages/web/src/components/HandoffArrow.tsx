import React, { useEffect, useState } from "react";

interface Props {
  from: string;
  to: string;
  agentIds: string[];
}

export function HandoffArrow({ from, to, agentIds }: Props) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 1800);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  const fromIdx = agentIds.indexOf(from);
  const toIdx = agentIds.indexOf(to);
  if (fromIdx === -1 || toIdx === -1) return null;

  const direction = toIdx > fromIdx ? "right" : "left";

  return (
    <div
      className={`handoff-arrow handoff-${direction}`}
      style={{
        left: `calc(${((fromIdx + 0.5) / agentIds.length) * 100}%)`,
      }}
    >
      <span className="arrow-particle">{direction === "right" ? "→" : "←"}</span>
      <span className="arrow-label">{from} → {to}</span>
    </div>
  );
}
