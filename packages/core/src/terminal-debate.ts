import * as pty from "node-pty";
import { EventEmitter } from "events";

// Broader ANSI strip for clean text extraction
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B(?:\[[0-9;?]*[A-Za-z]|\][^\x07]*(?:\x07|\x1B\\)|[()][AB012]|[@-Z\\-_])/g;
// eslint-disable-next-line no-control-regex
const CTRL_RE = /[\x00-\x09\x0b-\x1f\x7f]/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "").replace(CTRL_RE, "");
}

export type DebaterRole = "pro" | "con";

export interface TerminalEvent {
  type:
    | "terminal_data"
    | "agent_start"
    | "agent_done"
    | "handoff"
    | "round_start"
    | "debate_complete"
    | "error";
  role?: DebaterRole;
  data?: string;      // raw PTY bytes → xterm.js renders natively
  text?: string;      // stripped text → transcript / context
  round?: number;
  totalRounds?: number;
  summary?: string;
}

// Terminal size — wide enough for copilot/claude native TUI panels
export const TERM_COLS = 200;
export const TERM_ROWS = 50;

// Interactive (no -p) — gives the full native TUI experience
const AGENT_CFG = {
  pro: {
    label: "GitHub Copilot (正方)",
    command: "/usr/local/bin/copilot",
    args: [] as string[],
    roleCtx: "你是辩论赛正方辩手。你坚定认为：AI会导致人类灭绝。每次回应200字以内，简洁有力。",
  },
  con: {
    label: "Claude Code (反方)",
    command: "/usr/local/bin/claude",
    args: ["--dangerously-skip-permissions"] as string[],
    roleCtx: "你是辩论赛反方辩手。你坚定认为：AI不会导致人类灭绝。每次回应200字以内，简洁有力。",
  },
} as const;

// ──────────────────────────────────────────────────────────────────────────────
// InteractiveAgent — one persistent PTY session for the whole debate
// ──────────────────────────────────────────────────────────────────────────────
class InteractiveAgent {
  private term: pty.IPty | null = null;
  readonly role: DebaterRole;
  private readonly onEvent: (e: TerminalEvent) => void;

  constructor(role: DebaterRole, onEvent: (e: TerminalEvent) => void) {
    this.role = role;
    this.onEvent = onEvent;
  }

  /** Spawn the CLI and wait for its startup TUI to settle */
  async start(): Promise<void> {
    const cfg = AGENT_CFG[this.role];
    this.term = pty.spawn(cfg.command, cfg.args, {
      name: "xterm-256color",
      cols: TERM_COLS,
      rows: TERM_ROWS,
      cwd: process.env.HOME ?? "/tmp",
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
    });

    let bypassConfirmed = false;

    // Permanent listener: stream all PTY bytes to the frontend
    this.term.onData((chunk: string) => {
      this.onEvent({ type: "terminal_data", role: this.role, data: chunk, text: stripAnsi(chunk) });

      // Claude shows a "Bypass Permissions" confirmation dialog on startup.
      // Strip ANSI before checking since escape codes can split the text.
      if (!bypassConfirmed && stripAnsi(chunk).includes("Yes, I accept")) {
        bypassConfirmed = true;
        setTimeout(() => {
          this.term?.write("\x1B[B\r"); // ↓ arrow + Enter → selects option 2
        }, 300);
      }
    });

    // Wait for startup UI to settle (copilot welcome screen, claude TUI, etc.)
    await this.waitQuiet(7000);
  }

  /**
   * Write a prompt into the running CLI and wait for the response to settle.
   * Returns the clean (ANSI-stripped) text of everything the CLI output after typing.
   */
  async sendPrompt(prompt: string, quietMs = 5000): Promise<string> {
    if (!this.term) throw new Error("agent not started");

    let collected = "";
    const collector = this.term.onData((chunk: string) => {
      collected += stripAnsi(chunk);
    });

    // "Type" the prompt and press Enter — the CLI echoes it and then responds
    this.term.write(prompt + "\r");

    await this.waitQuiet(quietMs);
    collector.dispose();
    return collected.trim();
  }

  /** Gracefully quit the CLI session */
  stop(): void {
    const t = this.term;
    if (!t) return;
    this.term = null;
    try { t.write("/exit\r"); } catch { /* ignore */ }
    setTimeout(() => { try { t.kill("SIGTERM"); } catch { /* ignore */ } }, 1500);
  }

  /** Write raw bytes directly into the PTY (user manual input) */
  writeRaw(data: string): void {
    try { this.term?.write(data); } catch { /* ignore if session closed */ }
  }

  /** Resolve after `quietMs` ms of no new PTY data */
  private waitQuiet(quietMs: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.term) { resolve(); return; }
      let timer: ReturnType<typeof setTimeout>;
      const listener = this.term.onData(() => {
        clearTimeout(timer);
        timer = setTimeout(finish, quietMs);
      });
      function finish() {
        listener.dispose();
        resolve();
      }
      timer = setTimeout(finish, quietMs);
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// TerminalDebateEngine — orchestrates the full multi-round debate
// ──────────────────────────────────────────────────────────────────────────────
export class TerminalDebateEngine extends EventEmitter {
  private aborted = false;
  private proAgent: InteractiveAgent | null = null;
  private conAgent: InteractiveAgent | null = null;

  abort() {
    this.aborted = true;
    this.proAgent?.stop();
    this.conAgent?.stop();
    this.proAgent = null;
    this.conAgent = null;
  }

  /** Forward raw keystrokes from the user directly into the CLI PTY */
  sendInput(role: DebaterRole, data: string): void {
    const agent = role === "pro" ? this.proAgent : this.conAgent;
    agent?.writeRaw(data);
  }

  async runDebate(topic: string, rounds = 3): Promise<void> {
    this.aborted = false;
    const emit = (e: TerminalEvent) => this.emit("event", e);
    const log: string[] = [];
    let proCtx = "";
    let conCtx = "";

    // ── Phase 0: start both CLIs, show their native startup TUI ──────────────
    emit({ type: "round_start", round: 0, totalRounds: rounds }); // "initializing"

    emit({ type: "agent_start", role: "pro", round: 0 });
    this.proAgent = new InteractiveAgent("pro", emit);
    await this.proAgent.start();
    emit({ type: "agent_done", role: "pro", round: 0 });

    if (this.aborted) return;

    emit({ type: "agent_start", role: "con", round: 0 });
    this.conAgent = new InteractiveAgent("con", emit);
    await this.conAgent.start();
    emit({ type: "agent_done", role: "con", round: 0 });

    if (this.aborted) return;

    // ── Debate rounds ─────────────────────────────────────────────────────────
    for (let r = 1; r <= rounds; r++) {
      if (this.aborted) break;
      emit({ type: "round_start", round: r, totalRounds: rounds });

      // PRO turn
      emit({ type: "agent_start", role: "pro", round: r });
      const proMsg =
        r === 1
          ? `${AGENT_CFG.pro.roleCtx}\n\n辩题：${topic}\n\n请进行第一轮立论。`
          : `反方刚才说：${conCtx}\n\n请以正方身份进行第 ${r} 轮反驳（200字内）。`;
      const proResult = await this.proAgent.sendPrompt(proMsg);
      proCtx = proResult;
      log.push(`【正方 第${r}轮】\n${proResult}`);
      emit({ type: "agent_done", role: "pro", text: proResult, round: r });

      if (this.aborted) break;
      emit({ type: "handoff", role: "pro", text: proResult.slice(0, 120), round: r });

      // CON turn
      emit({ type: "agent_start", role: "con", round: r });
      const conMsg =
        r === 1
          ? `${AGENT_CFG.con.roleCtx}\n\n辩题：${topic}\n\n正方立论：${proCtx}\n\n请进行第一轮立论并反驳正方观点（200字内）。`
          : `正方刚才说：${proCtx}\n\n请以反方身份进行第 ${r} 轮反驳（200字内）。`;
      const conResult = await this.conAgent.sendPrompt(conMsg);
      conCtx = conResult;
      log.push(`【反方 第${r}轮】\n${conResult}`);
      emit({ type: "agent_done", role: "con", text: conResult, round: r });

      if (this.aborted) break;
      emit({ type: "handoff", role: "con", text: conResult.slice(0, 120), round: r });
    }

    this.proAgent?.stop();
    this.conAgent?.stop();
    this.proAgent = null;
    this.conAgent = null;

    emit({ type: "debate_complete", summary: log.join("\n\n---\n\n"), text: log.join("\n\n---\n\n") });
  }
}
