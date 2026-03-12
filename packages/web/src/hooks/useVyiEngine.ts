import { useState, useEffect, useCallback, useRef } from "react";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface AgentState {
  id: string;
  name: string;
  status: "idle" | "thinking" | "speaking" | "done";
  messages: Message[];
  currentToken: string;
}

export interface Handoff {
  from: string;
  to: string;
  active: boolean;
}

export interface TerminalAgentState {
  role: "pro" | "con";
  label: string;
  status: "idle" | "thinking" | "speaking" | "done";
  /** raw PTY bytes queued for xterm.js */
  chunks: string[];
  transcript: string;
}

export interface DebateEntry {
  round: number;
  role: "pro" | "con";
  label: string;
  text: string;
}

export interface TerminalDebateState {
  pro: TerminalAgentState;
  con: TerminalAgentState;
  round: number;
  totalRounds: number;
  summary: string;
  running: boolean;
  debateLog: DebateEntry[];
}

interface EngineEvent {
  type: "agent_start" | "token" | "agent_done" | "handoff" | "workflow_complete" | "error" | "agents"
    | "terminal_data" | "round_start" | "debate_complete" | "debate_aborted";
  agentId?: string;
  token?: string;
  result?: string;
  from?: string;
  to?: string;
  message?: string;
  agents?: unknown[];
  // terminal debate fields
  _source?: string;
  role?: "pro" | "con";
  data?: string;
  text?: string;
  round?: number;
  totalRounds?: number;
  summary?: string;
}

const AGENT_NAMES: Record<string, string> = {
  main: "Main",
  pro: "PRO 正方",
  con: "CON 反方",
  pm: "PM",
  dev: "Dev",
  qa: "QA",
};

function makeDefaultState(id: string): AgentState {
  return {
    id,
    name: AGENT_NAMES[id] ?? id,
    status: "idle",
    messages: [],
    currentToken: "",
  };
}

function makeTerminalState(): TerminalDebateState {
  return {
    pro: { role: "pro", label: "GitHub Copilot (正方)", status: "idle", chunks: [], transcript: "" },
    con: { role: "con", label: "Claude Code (反方)", status: "idle", chunks: [], transcript: "" },
    round: 0,
    totalRounds: 3,
    summary: "",
    running: false,
    debateLog: [],
  };
}

function uuidv4(): string {
  return crypto.randomUUID();
}

export function useVyiEngine() {
  const ALL_AGENT_IDS = ["main", "pro", "con", "pm", "dev", "qa"];

  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>(
    Object.fromEntries(ALL_AGENT_IDS.map((id) => [id, makeDefaultState(id)]))
  );
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [terminalState, setTerminalState] = useState<TerminalDebateState>(makeTerminalState());
  const wsRef = useRef<WebSocket | null>(null);

  function updateAgent(id: string, updater: (prev: AgentState) => AgentState) {
    setAgentStates((prev) => ({
      ...prev,
      [id]: updater(prev[id] ?? makeDefaultState(id)),
    }));
  }

  function updateTerminalAgent(role: "pro" | "con", updater: (prev: TerminalAgentState) => TerminalAgentState) {
    setTerminalState((prev) => ({ ...prev, [role]: updater(prev[role]) }));
  }

  useEffect(() => {
    let ws: WebSocket;
    let destroyed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      try {
        ws = new WebSocket("ws://127.0.0.1:3457");
        wsRef.current = ws;

        ws.addEventListener("open", () => {
          setConnected(true);
        });

        ws.addEventListener("close", () => {
          setConnected(false);
          if (!destroyed) {
            reconnectTimer = setTimeout(connect, 3000);
          }
        });

        ws.addEventListener("error", () => {
          ws.close();
        });

        ws.addEventListener("message", (ev) => {
          try {
            const event = JSON.parse(ev.data as string) as EngineEvent;
            handleEvent(event);
          } catch {
            // ignore
          }
        });
      } catch {
        if (!destroyed) reconnectTimer = setTimeout(connect, 3000);
      }
    }

    function handleEvent(event: EngineEvent) {
      const { type } = event;

      // ── Terminal debate events ──────────────────────
      if (event._source === "terminal_debate") {
        if (type === "round_start") {
          setTerminalState((prev) => ({
            ...prev,
            round: event.round ?? prev.round,
            totalRounds: event.totalRounds ?? prev.totalRounds,
            running: true,
          }));
        } else if (type === "agent_start" && event.role) {
          updateTerminalAgent(event.role, (p) => ({ ...p, status: "thinking", chunks: [] }));
          setIsRunning(true);
        } else if (type === "terminal_data" && event.role && event.data !== undefined) {
          updateTerminalAgent(event.role, (p) => ({
            ...p,
            status: "speaking",
            chunks: [...p.chunks, event.data!],
            transcript: p.transcript + (event.text ?? ""),
          }));
        } else if (type === "agent_done" && event.role) {
          updateTerminalAgent(event.role, (p) => ({ ...p, status: "done" }));
          // Append clean text to live debate log if we got actual content
          if (event.text && event.round && event.round > 0) {
            const label = event.role === "pro" ? "✅ 正方" : "🔴 反方";
            setTerminalState((prev) => ({
              ...prev,
              debateLog: [
                ...prev.debateLog,
                { round: event.round!, role: event.role!, label, text: event.text! },
              ],
            }));
          }
        } else if (type === "debate_complete") {
          setTerminalState((prev) => ({
            ...prev,
            running: false,
            summary: event.summary ?? "",
          }));
          setIsRunning(false);
        } else if (type === "debate_aborted") {
          setTerminalState((prev) => ({ ...prev, running: false }));
          setIsRunning(false);
        } else if (type === "error") {
          setIsRunning(false);
          console.error("Terminal debate error:", event.message);
        }
        return;
      }

      // ── OpenClaw agent events ───────────────────────
      const { agentId } = event;
      if (type === "agent_start" && agentId) {
        setIsRunning(true);
        updateAgent(agentId, (prev) => ({
          ...prev,
          status: "thinking",
          currentToken: "",
        }));
      } else if (type === "token" && agentId && event.token !== undefined) {
        updateAgent(agentId, (prev) => ({
          ...prev,
          status: "speaking",
          currentToken: prev.currentToken + event.token,
        }));
      } else if (type === "agent_done" && agentId) {
        const result = event.result ?? "";
        updateAgent(agentId, (prev) => ({
          ...prev,
          status: "done",
          currentToken: "",
          messages: [
            ...prev.messages,
            {
              id: uuidv4(),
              role: "assistant",
              content: result,
              timestamp: Date.now(),
            },
          ],
        }));
      } else if (type === "handoff" && event.from && event.to) {
        setHandoffs((prev) => [
          ...prev.filter((h) => !(h.from === event.from && h.to === event.to)),
          { from: event.from!, to: event.to!, active: true },
        ]);
        setTimeout(() => {
          setHandoffs((prev) =>
            prev.map((h) =>
              h.from === event.from && h.to === event.to ? { ...h, active: false } : h
            )
          );
        }, 2000);
      } else if (type === "workflow_complete") {
        setIsRunning(false);
        setTimeout(() => {
          setAgentStates((prev) =>
            Object.fromEntries(
              Object.entries(prev).map(([id, state]) => [
                id,
                { ...state, status: "idle" },
              ])
            )
          );
        }, 1500);
      } else if (type === "error") {
        setIsRunning(false);
        console.error("Engine error:", event.message);
      }
    }

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  const startDebate = useCallback((topic: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    setAgentStates((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([id, state]) => [
          id,
          { ...state, status: "idle", messages: [], currentToken: "" },
        ])
      )
    );
    setHandoffs([]);
    setIsRunning(true);
    ws.send(JSON.stringify({ type: "start_debate", topic }));
  }, []);

  const startDev = useCallback((task: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    setAgentStates((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([id, state]) => [
          id,
          { ...state, status: "idle", messages: [], currentToken: "" },
        ])
      )
    );
    setHandoffs([]);
    setIsRunning(true);
    ws.send(JSON.stringify({ type: "start_dev", task }));
  }, []);

  const startTerminalDebate = useCallback((topic: string, rounds = 3, proRoleCtx?: string, conRoleCtx?: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    setTerminalState(makeTerminalState());
    setIsRunning(true);
    ws.send(JSON.stringify({ type: "start_terminal_debate", topic, rounds, proRoleCtx, conRoleCtx }));
  }, []);

  /** Send raw user keystrokes into a CLI PTY (for manual intervention) */
  const sendTerminalInput = useCallback((role: "pro" | "con", data: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "terminal_input", role, data }));
  }, []);

  return { agentStates, handoffs, startDebate, startDev, startTerminalDebate, sendTerminalInput, isRunning, connected, terminalState };
}
