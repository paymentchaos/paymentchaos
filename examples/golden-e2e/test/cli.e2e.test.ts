import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ExitCode } from "@paymentchaos/core";
import { startExample as startCorrectExample } from "@paymentchaos/example-stripe-express-correct/boot";
import { startExample as startNaiveExample } from "@paymentchaos/example-stripe-express-naive/boot";
import { describe, expect, it } from "vitest";
import { createCliScenarioRunner } from "../src/cli-scenario-runner.js";

// Checkpoint 2: the real `paymentchaos run stripe-subscription-renewal`, end to end.
const examplesRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const seed = 1337;

describe("golden end-to-end via the paymentchaos CLI", () => {
  it("fails the naive example on duplicate renewal entitlements", async () => {
    const app = await startNaiveExample();
    try {
      const result = await createCliScenarioRunner({
        exampleDir: join(examplesRoot, "stripe-express-naive"),
      }).runStripeSubscriptionRenewal({
        targetWebhookUrl: `${app.baseUrl}/webhooks/stripe`,
        webhookSecret: app.webhookSecret,
        seed,
      });
      expect(result.exitCode, result.stdout).toBe(ExitCode.AssertionFailed);
      expect(result.stdout).toContain(
        "Duplicate invoice.paid delivery created 5 renewal ledger entries.",
      );
      expect(result.stdout).toContain("PAYMENTCHAOS FAILED");
      expect(result.stdout).toContain(
        `reproduce: npx paymentchaos run stripe-subscription-renewal --seed ${seed}\n`,
      );
      expect(result.stdout.match(/reproduce:/g)).toHaveLength(1);
      expect(result.stdout).not.toContain("repeat 1/1");
    } finally {
      await app.close();
    }
  });

  it("passes the correct example", async () => {
    const app = await startCorrectExample();
    try {
      const result = await createCliScenarioRunner({
        exampleDir: join(examplesRoot, "stripe-express-correct"),
      }).runStripeSubscriptionRenewal({
        targetWebhookUrl: `${app.baseUrl}/webhooks/stripe`,
        webhookSecret: app.webhookSecret,
        seed,
      });
      expect(result.exitCode, result.stdout).toBe(ExitCode.Ok);
      expect(result.stdout).toContain("PAYMENTCHAOS PASSED");
    } finally {
      await app.close();
    }
  });
});
