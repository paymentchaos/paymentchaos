import { ExitCode, PaymentChaosError, type RunReport } from "@paymentchaos/core";
import { describe, expect, it } from "vitest";
import { exitCodeFor, exitCodeForReport } from "../src/exit.ts";

describe("exit codes", () => {
  it("maps report status to CLI exit codes", () => {
    const passed = { status: "passed" } as RunReport;
    const failed = { status: "failed" } as RunReport;
    const error = { status: "error" } as RunReport;
    expect(exitCodeForReport(passed)).toBe(ExitCode.Ok);
    expect(exitCodeForReport(failed)).toBe(ExitCode.AssertionFailed);
    expect(exitCodeForReport(error)).toBe(ExitCode.Internal);
  });

  it("maps PaymentChaosError codes", () => {
    expect(exitCodeFor(new PaymentChaosError("REMOTE_TARGET_BLOCKED", "blocked"))).toBe(
      ExitCode.Config,
    );
    expect(exitCodeFor(new PaymentChaosError("TARGET_UNREACHABLE", "down"))).toBe(
      ExitCode.TargetUnreachable,
    );
    expect(exitCodeFor(new PaymentChaosError("ASSERTION_FAILED", "nope"))).toBe(
      ExitCode.AssertionFailed,
    );
  });
});
