import path from "node:path";
import { fileURLToPath } from "node:url";
import { PaymentChaosError } from "@paymentchaos/core";
import { describe, expect, it } from "vitest";
import { loadScenarioFile } from "../src/yaml/load.ts";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("YAML validation locations", () => {
  it("reports file:line for an invalid secret", async () => {
    const file = path.join(fixturesDir, "invalid-secret.yaml");
    await expect(loadScenarioFile(file)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
    try {
      await loadScenarioFile(file);
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentChaosError);
      const err = error as PaymentChaosError;
      expect(err.message).toContain("invalid-secret.yaml:");
      expect(err.message).toContain("${");
      expect(err.details?.line).toBe(8);
    }
  });
});
