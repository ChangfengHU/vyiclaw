import { Command } from "commander";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { listAgents, AgentEngine, TerminalDebateEngine } from "@vyiclaw/core";
import type { TerminalEvent } from "@vyiclaw/core";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function getMimeType(ext: string): string {
  const types: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
  };
  return types[ext] ?? "application/octet-stream";
}

function handleApiRequest(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.url === "/api/agents") {
    const agents = listAgents();
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(agents));
    return true;
  }
  return false;
}

function startWebSocketServer(wsPort: number): void {
  const engine = new AgentEngine();
  let termDebate: TerminalDebateEngine | null = null;
  const wss = new WebSocketServer({ port: wsPort, host: "127.0.0.1" });

  function broadcast(wss: WebSocketServer, data: unknown) {
    const json = JSON.stringify(data);
    wss.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) c.send(json);
    });
  }

  wss.on("connection", (ws: WebSocket) => {
    function send(data: unknown): void {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    }

    ws.on("message", async (raw: Buffer) => {
      let msg: { type: string; topic?: string; task?: string; rounds?: number; role?: string; data?: string };
      try {
        msg = JSON.parse(raw.toString()) as typeof msg;
      } catch {
        return;
      }

      if (msg.type === "start_debate" && msg.topic) {
        try {
          await engine.runDebate(msg.topic, (event) => send(event));
        } catch (err) {
          send({ type: "error", message: String(err) });
        }
      } else if (msg.type === "start_dev" && msg.task) {
        try {
          await engine.runDev(msg.task, (event) => send(event));
        } catch (err) {
          send({ type: "error", message: String(err) });
        }
      } else if (msg.type === "start_terminal_debate" && msg.topic) {
        // Stop any ongoing debate
        if (termDebate) {
          termDebate.abort();
          termDebate.removeAllListeners();
        }
        termDebate = new TerminalDebateEngine();
        termDebate.on("event", (ev: TerminalEvent) => {
          broadcast(wss, { ...ev, _source: "terminal_debate" });
          if (ev.type === "debate_complete") {
            termDebate = null;
          }
        });
        // Run in background so WS stays open
        termDebate.runDebate(msg.topic, msg.rounds ?? 3).catch((err) => {
          broadcast(wss, { type: "error", message: String(err), _source: "terminal_debate" });
        });
      } else if (msg.type === "abort_terminal_debate") {
        if (termDebate) {
          termDebate.abort();
          termDebate.removeAllListeners();
          termDebate = null;
          broadcast(wss, { type: "debate_aborted", _source: "terminal_debate" });
        }
      } else if (msg.type === "terminal_input" && msg.role && msg.data) {
        // Forward user keystrokes directly into the CLI PTY
        termDebate?.sendInput(msg.role as "pro" | "con", msg.data);
      }
    });

    // Send initial agents list
    send({ type: "agents", agents: listAgents() });
  });

  console.log(`   WebSocket engine on ws://127.0.0.1:${wsPort}`);
}

export const webCommand = new Command("web")
  .description("Start the Vyiclaw web dashboard")
  .option("-p, --port <port>", "Port to listen on", "3456")
  .option("--ws-port <port>", "WebSocket engine port", "3457")
  .action(async (options: { port: string; wsPort: string }) => {
    const port = parseInt(options.port, 10);
    const wsPort = parseInt(options.wsPort, 10);

    const candidates = [
      resolve(__dirname, "../../web/dist"),
      resolve(__dirname, "../../../web/dist"),
      resolve(process.cwd(), "packages/web/dist"),
    ];

    const distDir = candidates.find((d) => existsSync(join(d, "index.html")));

    if (!distDir) {
      console.error("Web assets not found. Please run: cd packages/web && pnpm build");
      console.error("Searched in:", candidates.join(", "));
      process.exit(1);
    }

    // Start WebSocket engine server
    startWebSocketServer(wsPort);

    const server = createServer((req, res) => {
      if (handleApiRequest(req, res)) return;

      let urlPath = req.url ?? "/";
      urlPath = urlPath.split("?")[0];
      if (urlPath === "/" || urlPath === "") urlPath = "/index.html";

      const filePath = join(distDir!, urlPath);
      const resolved = resolve(filePath);
      if (!resolved.startsWith(resolve(distDir!))) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      if (existsSync(resolved)) {
        const ext = resolved.slice(resolved.lastIndexOf("."));
        const mime = getMimeType(ext);
        res.writeHead(200, { "Content-Type": mime });
        res.end(readFileSync(resolved));
      } else {
        const indexPath = join(distDir!, "index.html");
        if (existsSync(indexPath)) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(readFileSync(indexPath));
        } else {
          res.writeHead(404);
          res.end("Not found");
        }
      }
    });

    server.listen(port, "127.0.0.1", () => {
      const agents = listAgents();
      console.log(`\n⚡ Vyiclaw web dashboard running at http://127.0.0.1:${port}`);
      console.log(`   Serving ${agents.length} agent(s): ${agents.map((a) => a.id).join(", ") || "none"}`);
      console.log("\nPress Ctrl+C to stop.\n");
    });
  });
