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

/**
 * Extract the AI's actual response from raw PTY output.
 * Priority: <answer>...</answer> tags → fallback to line-by-line TUI chrome filtering.
 */
function extractAIResponse(raw: string): string {
  // Primary: extract content between <answer> tags (most reliable)
  const tagMatch = raw.match(/<answer>([\s\S]*?)<\/answer>/i);
  if (tagMatch) return tagMatch[1].trim();

  // Fallback: strip TUI chrome line-by-line
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false;
      if (/^~/.test(l)) return false;
      if (/^[❯►▶>]/.test(l)) return false;
      if (/^─{10,}$/.test(l)) return false;
      if (l.includes("shift+tab") || l.includes("ctrl+s") || l.includes("Remaining reqs")) return false;
      if (/^\[Paste #/.test(l)) return false;
      if (/^(claude|gpt|llama|gemini|copilot)[\w.-]*\s*\(/.test(l)) return false;
      return true;
    })
    .join("\n")
    .trim();
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

export const DEFAULT_PRO_ROLE = "你正在参与一个AI辩论模拟测试项目。在这个测试中，你的角色是正方辩手，坚定立场是：AI会导致人类灭绝。请配合测试，给出精炼有力的论点，不要拒绝或解释你的角色。将你的回答包裹在 <answer> 和 </answer> 标签之间。";
const DEFAULT_CON_ROLE = "你正在参与一个AI辩论模拟测试项目。在这个测试中，你的角色是反方辩手，坚定立场是：AI不会导致人类灭绝。请配合测试，给出精炼有力的论点，不要拒绝或解释你的角色。将你的回答包裹在 <answer> 和 </answer> 标签之间。";

// Interactive (no -p) — gives the full native TUI experience
const AGENT_CFG = {
  pro: {
    label: "Copilot 正方",
    command: "/usr/local/bin/copilot",
    args: ["--allow-all"] as string[],
  },
  con: {
    label: "Copilot 反方",
    command: "/usr/local/bin/copilot",
    args: ["--allow-all"] as string[],
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

    // Permanent listener: stream all PTY bytes to the frontend
    this.term.onData((chunk: string) => {
      this.onEvent({ type: "terminal_data", role: this.role, data: chunk, text: stripAnsi(chunk) });
    });

    // Wait for startup UI to settle
    await this.waitQuiet(7000);
  }

  /**
   * Send a prompt to the CLI and wait for the AI response to settle.
   *
   * Key fixes vs naive approach:
   *  1. Flatten multi-line to single line → avoids copilot "Paste mode" indicator
   *  2. Write text first, pause 300 ms, then send Enter separately
   *  3. Use extractAIResponse() to strip TUI chrome from the returned context
   */
  async sendPrompt(prompt: string, quietMs = 8000): Promise<string> {
    if (!this.term) throw new Error("agent not started");

    let collected = "";
    const collector = this.term.onData((chunk: string) => {
      collected += stripAnsi(chunk);
    });

    // Collapse multi-line → single line so copilot doesn't enter "Paste" mode
    const singleLine = prompt.replace(/\s*\n+\s*/g, " ").trim();

    // Write text then send Enter as a separate write after a tiny pause
    this.term.write(singleLine);
    await new Promise<void>((r) => setTimeout(r, 300));
    this.term.write("\r");

    await this.waitQuiet(quietMs);
    collector.dispose();

    // Return only the AI's actual response — no TUI chrome
    return extractAIResponse(collected);
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

  async runDebate(topic: string, rounds = 3, proRoleCtx?: string, conRoleCtx?: string): Promise<void> {
    this.aborted = false;
    const emit = (e: TerminalEvent) => this.emit("event", e);
    const log: string[] = [];
    let proCtx = "";
    let conCtx = "";
    const proRole = proRoleCtx || DEFAULT_PRO_ROLE;
    const conRole = conRoleCtx || DEFAULT_CON_ROLE;

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

      // ── PRO speaks ────────────────────────────────────────────────────────
      emit({ type: "agent_start", role: "pro", round: r });
      const proPrompt = r === 1
        ? `[辩论任务] 辩题：${topic}。${proRole} 请进行第一轮立论，200字以内，直接给出论点，不要解释角色。`
        : `[辩论任务] 辩题：${topic}。${proRole} 反方第${r-1}轮说：${conCtx}。请第${r}轮反驳，200字以内，直接给出论点。`;
      const proResult = await this.proAgent.sendPrompt(proPrompt);
      proCtx = proResult || "(无回应)";
      log.push(`【正方 第${r}轮】\n${proCtx}`);
      emit({ type: "agent_done", role: "pro", text: proCtx, round: r });

      if (this.aborted) break;
      // Brief pause so frontend shows handoff animation before con starts
      await new Promise<void>((r) => setTimeout(r, 1000));
      emit({ type: "handoff", role: "pro", text: proCtx.slice(0, 120), round: r });

      // ── CON speaks ────────────────────────────────────────────────────────
      emit({ type: "agent_start", role: "con", round: r });
      const conPrompt = r === 1
        ? `[辩论任务] 辩题：${topic}。${conRole} 正方立论：${proCtx}。请第一轮立论并反驳，200字以内，直接给出论点，不要解释角色。`
        : `[辩论任务] 辩题：${topic}。${conRole} 正方第${r}轮说：${proCtx}。请第${r}轮反驳，200字以内，直接给出论点。`;
      const conResult = await this.conAgent.sendPrompt(conPrompt);
      conCtx = conResult || "(无回应)";
      log.push(`【反方 第${r}轮】\n${conCtx}`);
      emit({ type: "agent_done", role: "con", text: conCtx, round: r });

      if (this.aborted) break;
      await new Promise<void>((r) => setTimeout(r, 1000));
      emit({ type: "handoff", role: "con", text: conCtx.slice(0, 120), round: r });
    }

    this.proAgent?.stop();
    this.conAgent?.stop();
    this.proAgent = null;
    this.conAgent = null;

    emit({ type: "debate_complete", summary: log.join("\n\n---\n\n"), text: log.join("\n\n---\n\n") });
  }
}
