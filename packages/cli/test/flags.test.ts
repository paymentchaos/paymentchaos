import { PaymentChaosError } from "@paymentchaos/core";
import { describe, expect, it } from "vitest";
import { parseOptionalPositiveInt, parseOptionalSeed } from "../src/flags.ts";

describe("CLI numeric flags", () => {
  it("rejects partial integers", () => {
    expect(() => parseOptionalPositiveInt("12abc", "repeat")).toThrow(PaymentChaosError);
  });

  it("rejects unsafe huge integers", () => {
    const huge = "9".repeat(400);
    expect(() => parseOptionalPositiveInt(huge, "repeat")).toThrow(PaymentChaosError);
  });

  it("accepts positive safe integers", () => {
    expect(parseOptionalPositiveInt("20", "repeat")).toBe(20);
  });

  it("accepts signed safe integer seeds", () => {
    expect(parseOptionalSeed("0")).toBe(0);
    expect(parseOptionalSeed("-1")).toBe(-1);
    expect(parseOptionalSeed("1337")).toBe(1337);
    expect(() => parseOptionalSeed("12.5")).toThrow(PaymentChaosError);
    expect(() => parseOptionalSeed("9".repeat(400))).toThrow(PaymentChaosError);
  });
});
