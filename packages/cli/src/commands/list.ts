import { Command } from "commander";
import { listAgents } from "@vyiclaw/core";

export const listCommand = new Command("list")
  .description("List all configured OpenClaw agents")
  .action(() => {
    const agents = listAgents();
    if (agents.length === 0) {
      console.log("No agents configured. Use `vyiclaw add agent <id>` to add one.");
      return;
    }
    console.log("\nConfigured agents:\n");
    for (const agent of agents) {
      const name = agent.name ?? agent.id;
      const model = agent.model ? ` [${agent.model}]` : "";
      const ws = agent.workspace ? `  workspace: ${agent.workspace}` : "";
      console.log(`  • ${name} (id: ${agent.id})${model}${ws ? "\n" + ws : ""}`);
    }
    console.log();
  });
