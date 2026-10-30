import { runCases } from "./cases.ts";
import { createHarness } from "./harness.ts";

export async function runSandbox(root: string, bin?: string) {
  const harness = await createHarness(root, 20_000, bin);
  try {
    await runCases(harness);
  } finally {
    await harness.finish();
  }
  return { directory: harness.directory, results: harness.results };
}
