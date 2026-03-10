#!/usr/bin/env node
import { createRequire } from "module";
// Ensure tsx is available for ESM TypeScript execution
const require = createRequire(import.meta.url);

import { program } from "commander";
import { listCommand } from "./commands/list.js";
import { addAgentCommand } from "./commands/add-agent.js";
import { webCommand } from "./commands/web.js";
import { tuiCommand } from "./commands/tui.js";

program
  .name("vyiclaw")
  .description("Multi-agent collaboration visualization for OpenClaw")
  .version("0.1.0");

program.addCommand(listCommand);
program.addCommand(addAgentCommand);
program.addCommand(webCommand);
program.addCommand(tuiCommand);

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
