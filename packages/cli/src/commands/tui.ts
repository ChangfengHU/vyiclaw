import { Command } from "commander";
import { spawnSync } from "child_process";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export const tuiCommand = new Command("tui")
  .description("Start the Vyiclaw terminal UI")
  .option(
    "--agents <agents>",
    "Comma-separated agent IDs to display (e.g. main,debate-pro,debate-con)"
  )
  .action((options: { agents?: string }) => {
    const tuiEntry = resolve(__dirname, "../../../tui/src/index.ts");
    const args = ["--import", "tsx/esm", tuiEntry];
    if (options.agents) {
      args.push("--agents", options.agents);
    }

    const result = spawnSync("node", args, {
      stdio: "inherit",
      env: process.env,
    });

    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  });
