import { Command } from "commander";
import { addAgent } from "@vyiclaw/core";

export const addAgentCommand = new Command("add")
  .description("Add a new agent")
  .command("agent <id>")
  .description("Add a new OpenClaw agent by id")
  .option("--name <name>", "Human-readable agent name")
  .option("--model <model>", "Model to use (e.g. claude-3-5-sonnet)")
  .action((id: string, options: { name?: string; model?: string }) => {
    console.log(`Adding agent: ${id}...`);
    try {
      addAgent(id, options);
      console.log(`Agent '${id}' added successfully.`);
    } catch (err) {
      console.error("Failed to add agent:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });
