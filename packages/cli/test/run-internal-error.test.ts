import { ExitCode } from "@paymentchaos/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.ts";

// An unexpected (non-PaymentChaosError) failure inside a command maps to exit 4 at the
// CLI's single error boundary.
vi.mock("../src/engine/create-engine.ts", () => ({
  createEngine: () => Promise.reject(new TypeError("engine exploded")),
}));

let stderr: string;

beforeEach(() => {
  stderr = "";
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${String(code)}) called`);
  });
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    stderr += `${parts.map(String).join(" ")}\n`;
  });
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("paymentchaos internal errors", () => {
  it("exits 4 and prints the message once", async () => {
    await runCli(["run", "stripe-subscription-renewal"]);
    expect(Number(process.exitCode)).toBe(ExitCode.Internal);
    expect(stderr.match(/engine exploded/g)).toHaveLength(1);
  });
});
