import { PaymentChaosError } from "@paymentchaos/core";
import { describe, expect, it } from "vitest";
import { assertTargetAllowed } from "../src/engine/target-guard.ts";

describe("remote target guard", () => {
  it("allows loopback by default", () => {
    expect(() => assertTargetAllowed("http://127.0.0.1:3000/hook")).not.toThrow();
  });

  it("blocks public hosts without --allow-remote-target", () => {
    expect(() => assertTargetAllowed("https://api.example.com/webhooks")).toThrow(
      PaymentChaosError,
    );
    try {
      assertTargetAllowed("https://api.example.com/webhooks");
    } catch (error) {
      expect((error as PaymentChaosError).code).toBe("REMOTE_TARGET_BLOCKED");
    }
  });

  it("allows an explicitly permitted hostname", () => {
    expect(() =>
      assertTargetAllowed("https://api.example.com/webhooks", "api.example.com"),
    ).not.toThrow();
  });
});
