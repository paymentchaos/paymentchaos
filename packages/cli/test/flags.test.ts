import { PaymentChaosError } from "@paymentchaos/core";
import { describe, expect, it } from "vitest";
import { parseOptionalPositiveInt, parseOptionalSeed } from "../src/flags.ts";

describe("CLI numeric flags", () => {
  it("rejects partial integers", () => {
    expect(() => parseOptionalPositiveInt("12abc", "repeat")).toThrow(PaymentChaosError);
  });

  it("accepts positive integers", () => {
    expect(parseOptionalPositiveInt("20", "repeat")).toBe(20);
  });

  it("validates seed range", () => {
    expect(parseOptionalSeed("0")).toBe(0);
    expect(() => parseOptionalSeed("-1")).toThrow(PaymentChaosError);
    expect(() => parseOptionalSeed("12.5")).toThrow(PaymentChaosError);
  });
});
