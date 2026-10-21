import { PaymentChaosError } from "@paymentchaos/core";
import { describe, expect, it } from "vitest";
import { closestScenarioNames } from "../src/scenario/resolve.ts";

describe("scenario name resolution", () => {
  it("suggests close built-in names", () => {
    expect(
      closestScenarioNames("stripe-subscription-renewl", ["stripe-subscription-renewal"]),
    ).toEqual(["stripe-subscription-renewal"]);
  });

  it("maps unknown names to exit code 2 via PaymentChaosError", () => {
    const err = new PaymentChaosError("SCENARIO_NOT_FOUND", "missing");
    expect(err.exitCode).toBe(2);
  });
});
