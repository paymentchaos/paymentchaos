import path from "node:path";
import { describe, expect, it } from "vitest";
import { projectScenarioPath } from "../src/yaml/load.ts";

describe("Windows-safe paths", () => {
  it("joins scenario paths with node:path", () => {
    const joined = projectScenarioPath("C:\\\\project", "stripe-subscription-renewal");
    expect(joined).toBe(
      path.join("C:\\\\project", "paymentchaos", "scenarios", "stripe-subscription-renewal.yaml"),
    );
  });
});
