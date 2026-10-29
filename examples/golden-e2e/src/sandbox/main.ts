import { resolve } from "node:path";
import { messages } from "./messages.ts";
import { runSandbox } from "./run.ts";

try {
  const root = process.argv[2];
  if (!root || process.argv.length !== 3) throw new Error(messages.usage);
  const { directory, results } = await runSandbox(resolve(root));
  const passed = results.filter((r) => r.pass).length;
  console.log(messages.finished(passed, results.length, directory));
  process.exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
