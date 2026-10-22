#!/usr/bin/env node
import { runCli } from "./cli.ts";
import { exitCodeFor } from "./exit.ts";

try {
  await runCli();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(exitCodeFor(error));
}
