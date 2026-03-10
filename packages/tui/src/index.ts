#!/usr/bin/env node
import blessed from "blessed";
import { program } from "commander";
import { VyiGatewayClient, listAgents, agentSessionKey } from "@vyiclaw/core";

program
  .name("vyiclaw-tui")
  .description("Vyiclaw terminal UI")
  .option(
    "--agents <agents>",
    "Comma-separated agent IDs to display",
    "main"
  )
  .parse(process.argv);

const opts = program.opts<{ agents: string }>();
const requestedIds = opts.agents.split(",").map((s) => s.trim()).filter(Boolean);

// Merge with config
const configAgents = listAgents();
const agentIds = requestedIds.length > 0 ? requestedIds : configAgents.map((a) => a.id).slice(0, 3);

if (agentIds.length === 0) {
  console.error("No agents specified. Use --agents main,debate-pro,debate-con");
  process.exit(1);
}

// Cap at 5 for readability
const displayIds = agentIds.slice(0, 5);

// ──────────────────────────────────────────────────────────
// Build blessed screen
// ──────────────────────────────────────────────────────────
const screen = blessed.screen({
  smartCSR: true,
  title: "Vyiclaw | Multi-Agent Terminal Dashboard",
  fullUnicode: true,
});

screen.key(["q", "C-c"], () => {
  process.exit(0);
});

// Status bar at bottom
const statusBar = blessed.box({
  bottom: 2,
  left: 0,
  width: "100%",
  height: 1,
  content: " ⚡ Vyiclaw | Connecting…",
  tags: true,
  style: {
    fg: "white",
    bg: "black",
  },
});
screen.append(statusBar);

// Input bar
const inputBox = blessed.textbox({
  bottom: 0,
  left: 0,
  width: "100%",
  height: 2,
  border: { type: "line" },
  style: {
    fg: "white",
    bg: "black",
    border: { fg: "blue" },
  },
  inputOnFocus: true,
});
screen.append(inputBox);

// Agent panels
type PanelData = {
  id: string;
  name: string;
  sessionKey: string;
  box: blessed.Widgets.BoxElement;
  log: blessed.Widgets.Log;
};

const panels: PanelData[] = [];
const panelWidth = Math.floor(100 / displayIds.length);

for (let i = 0; i < displayIds.length; i++) {
  const id = displayIds[i];
  const agentInfo = configAgents.find((a) => a.id === id);
  const name = agentInfo?.name ?? id;
  const sessionKey = agentSessionKey(id);
  const leftPct = `${i * panelWidth}%`;
  const widthPct = i === displayIds.length - 1 ? `${100 - i * panelWidth}%` : `${panelWidth}%`;

  const box = blessed.box({
    top: 0,
    left: leftPct,
    width: widthPct,
    bottom: 3,
    border: { type: "line" },
    label: ` ${name} `,
    tags: true,
    style: {
      border: { fg: "blue" },
      label: { fg: "cyan", bold: true },
    },
  });

  const log = blessed.log({
    parent: box,
    top: 0,
    left: 0,
    width: "100%-2",
    height: "100%-2",
    scrollable: true,
    alwaysScroll: true,
    tags: true,
    scrollbar: {
      ch: "│",
      style: { fg: "gray" },
    },
    style: { fg: "white" },
  });

  screen.append(box);
  panels.push({ id, name, sessionKey, box, log });
}

// Current focused panel index
let focusedIndex = 0;

function highlightFocused() {
  for (let i = 0; i < panels.length; i++) {
    panels[i].box.style.border = {
      fg: i === focusedIndex ? "green" : "blue",
    };
  }
  screen.render();
}

screen.key("tab", () => {
  focusedIndex = (focusedIndex + 1) % panels.length;
  highlightFocused();
});

highlightFocused();

// Handle enter to send message to focused panel
inputBox.key("enter", async () => {
  const text = (inputBox.getValue() as string).trim();
  if (!text) return;
  inputBox.clearValue();
  screen.render();
  const panel = panels[focusedIndex];
  panel.log.log(`{blue-fg}You:{/blue-fg} ${escapeMarkup(text)}`);
  screen.render();
  try {
    await client.sendMessage(panel.sessionKey, text);
  } catch (err) {
    panel.log.log(`{red-fg}[Error sending message]{/red-fg}`);
    screen.render();
  }
});

function escapeMarkup(text: string): string {
  return text.replace(/[{}]/g, (c) => (c === "{" ? "\\{" : "\\}"));
}

// ──────────────────────────────────────────────────────────
// Gateway client
// ──────────────────────────────────────────────────────────
const client = new VyiGatewayClient();

function setStatus(text: string, color: string = "white") {
  statusBar.setContent(` {${color}-fg}⚡ Vyiclaw{/${color}-fg} | ${escapeMarkup(text)}`);
  screen.render();
}

const currentAssistant: Map<string, string | null> = new Map();
const currentThinking: Map<string, string | null> = new Map();

for (const panel of panels) {
  currentAssistant.set(panel.sessionKey, null);
  currentThinking.set(panel.sessionKey, null);

  client.onAgentEvent(panel.sessionKey, (payload) => {
    const { stream, delta, text, toolName, state } = payload;
    const content = (delta ?? text ?? "") as string;

    if (stream === "assistant") {
      if (content) {
        const existing = currentAssistant.get(panel.sessionKey);
        if (!existing) {
          currentAssistant.set(panel.sessionKey, content);
          panel.log.log(`{green-fg}Agent:{/green-fg} ${escapeMarkup(content)}`);
        } else {
          // Append to last line (approximate)
          currentAssistant.set(panel.sessionKey, existing + content);
          // Re-render last item by pushing space (blessed log limitation workaround)
          panel.log.setLine(
            panel.log.getLines().length - 1,
            `{green-fg}Agent:{/green-fg} ${escapeMarkup(existing + content)}`
          );
        }
        screen.render();
      }
    } else if (stream === "thinking") {
      if (content) {
        const existing = currentThinking.get(panel.sessionKey);
        if (!existing) {
          currentThinking.set(panel.sessionKey, content);
          panel.log.log(`{magenta-fg}[Thinking]{/magenta-fg} ${escapeMarkup(content)}`);
        } else {
          currentThinking.set(panel.sessionKey, existing + content);
          panel.log.setLine(
            panel.log.getLines().length - 1,
            `{magenta-fg}[Thinking]{/magenta-fg} ${escapeMarkup(existing + content)}`
          );
        }
        screen.render();
      }
    } else if (stream === "tool") {
      if (toolName) {
        panel.log.log(`{yellow-fg}[Tool] ${escapeMarkup(toolName as string)}{/yellow-fg}`);
        screen.render();
      }
    } else if (stream === "lifecycle") {
      if (state === "start") {
        panel.box.style.border = { fg: "green" };
        currentAssistant.set(panel.sessionKey, null);
        currentThinking.set(panel.sessionKey, null);
        screen.render();
      } else if (state === "end" || state === "done") {
        panel.box.style.border = {
          fg: panels.indexOf(panel) === focusedIndex ? "green" : "blue",
        };
        currentAssistant.set(panel.sessionKey, null);
        currentThinking.set(panel.sessionKey, null);
        screen.render();
      }
    }
  });

  client.onChatEvent(panel.sessionKey, (payload) => {
    if (payload.state === "final" && payload.message) {
      const { role, content } = payload.message;
      if (role === "assistant") {
        const existing = currentAssistant.get(panel.sessionKey);
        if (!existing) {
          panel.log.log(`{green-fg}Agent:{/green-fg} ${escapeMarkup(content)}`);
        }
        // If we had a streaming version, it's already shown
        currentAssistant.set(panel.sessionKey, null);
        screen.render();
      }
    }
  });
}

// Connect
setStatus("Connecting to gateway…", "yellow");

client
  .connect()
  .then(async () => {
    setStatus(`Connected — ${displayIds.length} agent(s) | Tab: switch focus | Enter: send | q: quit`, "green");

    // Load history for each panel
    for (const panel of panels) {
      try {
        const history = (await client.loadHistory(panel.sessionKey)) as {
          messages?: Array<{ role: string; content: string }>;
        };
        if (history?.messages) {
          for (const m of history.messages.slice(-20)) {
            const color =
              m.role === "user"
                ? "blue"
                : m.role === "assistant"
                  ? "green"
                  : "white";
            panel.log.log(
              `{${color}-fg}${m.role}:{/${color}-fg} ${escapeMarkup(m.content.slice(0, 200))}${m.content.length > 200 ? "…" : ""}`
            );
          }
          screen.render();
        }
      } catch {
        // No history available
      }
    }

    // Focus input
    inputBox.focus();
    screen.render();
  })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(`Connection failed: ${msg}`, "red");
    for (const panel of panels) {
      panel.log.log(`{red-fg}[Error] Could not connect to OpenClaw gateway: ${escapeMarkup(msg)}{/red-fg}`);
    }
    screen.render();
  });

inputBox.focus();
screen.render();
