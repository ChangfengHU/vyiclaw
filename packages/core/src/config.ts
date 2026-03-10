import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { execSync } from "child_process";

export interface AgentConfig {
  id: string;
  name: string;
  workspace?: string;
  model?: string;
}

export interface OpenClawConfig {
  agents?: {
    list?: AgentConfig[];
  };
  [key: string]: unknown;
}

const CONFIG_PATH = join(homedir(), ".openclaw", "openclaw.json");

export function readConfig(): OpenClawConfig {
  if (!existsSync(CONFIG_PATH)) {
    return {};
  }
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as OpenClawConfig;
  } catch {
    return {};
  }
}

export function listAgents(): AgentConfig[] {
  const config = readConfig();
  return config.agents?.list ?? [];
}

export function agentSessionKey(agentId: string): string {
  return `agent:${agentId}:main`;
}

export function addAgent(
  id: string,
  options: { name?: string; model?: string } = {}
): void {
  const args: string[] = ["openclaw", "agents", "add", id];
  if (options.name) args.push("--name", options.name);
  if (options.model) args.push("--model", options.model);
  execSync(args.join(" "), { stdio: "inherit" });
}
