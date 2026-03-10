import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";

export interface GatewayRequest {
  type: "req";
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface GatewayResponse {
  type: "res";
  id: string;
  ok: boolean;
  payload: unknown;
}

export interface AgentEventPayload {
  sessionKey: string;
  stream: "assistant" | "tool" | "thinking" | "lifecycle";
  delta?: string;
  text?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  state?: string;
  [key: string]: unknown;
}

export interface ChatEventPayload {
  sessionKey: string;
  state: "delta" | "final";
  delta?: string;
  message?: {
    role: string;
    content: string;
  };
  [key: string]: unknown;
}

export interface GatewayEvent {
  type: "event";
  event: "agent" | "chat";
  payload: AgentEventPayload | ChatEventPayload;
}

type AgentEventCallback = (payload: AgentEventPayload) => void;
type ChatEventCallback = (payload: ChatEventPayload) => void;

export class VyiGatewayClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private pendingRequests = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private agentListeners = new Map<string, AgentEventCallback[]>();
  private chatListeners = new Map<string, ChatEventCallback[]>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;

  constructor(url = "ws://127.0.0.1:18789/") {
    this.url = url;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.on("open", async () => {
        try {
          await this.sendRequest("connect", { token: "" });
          this.connected = true;
          resolve();
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });

      this.ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString()) as
            | GatewayResponse
            | GatewayEvent;
          this.handleMessage(msg);
        } catch {
          // ignore parse errors
        }
      });

      this.ws.on("error", (err) => {
        if (!this.connected) {
          reject(err);
        }
      });

      this.ws.on("close", () => {
        this.connected = false;
        this.scheduleReconnect();
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch {
        this.scheduleReconnect();
      }
    }, 3000);
  }

  private handleMessage(msg: GatewayResponse | GatewayEvent): void {
    if (msg.type === "res") {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        if (msg.ok) {
          pending.resolve(msg.payload);
        } else {
          pending.reject(new Error(`Gateway error for request ${msg.id}`));
        }
      }
    } else if (msg.type === "event") {
      const payload = msg.payload;
      const sessionKey =
        (payload as Record<string, unknown>).sessionKey as string;
      if (msg.event === "agent") {
        const listeners = this.agentListeners.get(sessionKey) ?? [];
        // also fire wildcard listeners
        const wildcardListeners = this.agentListeners.get("*") ?? [];
        for (const cb of [...listeners, ...wildcardListeners]) {
          cb(payload as AgentEventPayload);
        }
      } else if (msg.event === "chat") {
        const listeners = this.chatListeners.get(sessionKey) ?? [];
        const wildcardListeners = this.chatListeners.get("*") ?? [];
        for (const cb of [...listeners, ...wildcardListeners]) {
          cb(payload as ChatEventPayload);
        }
      }
    }
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"));
        return;
      }
      const id = uuidv4();
      this.pendingRequests.set(id, { resolve, reject });
      const req: GatewayRequest = { type: "req", id, method, params };
      this.ws.send(JSON.stringify(req));
      // timeout after 30s
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} timed out`));
        }
      }, 30_000);
    });
  }

  async sendMessage(sessionKey: string, message: string): Promise<unknown> {
    return this.sendRequest("chat.send", { sessionKey, message });
  }

  async loadHistory(sessionKey: string): Promise<unknown> {
    return this.sendRequest("chat.history", { sessionKey });
  }

  onAgentEvent(sessionKey: string, callback: AgentEventCallback): () => void {
    const listeners = this.agentListeners.get(sessionKey) ?? [];
    listeners.push(callback);
    this.agentListeners.set(sessionKey, listeners);
    return () => {
      const updated = (this.agentListeners.get(sessionKey) ?? []).filter(
        (cb) => cb !== callback
      );
      this.agentListeners.set(sessionKey, updated);
    };
  }

  onChatEvent(sessionKey: string, callback: ChatEventCallback): () => void {
    const listeners = this.chatListeners.get(sessionKey) ?? [];
    listeners.push(callback);
    this.chatListeners.set(sessionKey, listeners);
    return () => {
      const updated = (this.chatListeners.get(sessionKey) ?? []).filter(
        (cb) => cb !== callback
      );
      this.chatListeners.set(sessionKey, updated);
    };
  }

  isConnected(): boolean {
    return this.connected;
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
  }
}
