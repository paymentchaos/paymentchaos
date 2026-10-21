import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startExample as startCorrectExample } from "@paymentchaos/example-stripe-express-correct/boot";
import { startExample as startNaiveExample } from "@paymentchaos/example-stripe-express-naive/boot";
import { describe, expect, it } from "vitest";
import { parseChecks, runVerifyScript } from "../src/run-verify.js";
import { createScenarioRunner } from "../src/scenario-runner.js";

const examplesRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const ids = {
  customer: "cus_internal_pc_e2e_001",
  stripeCustomer: "cus_pc_e2e_001",
  subscription: "sub_pc_e2e_001",
} as const;

describe("golden end-to-end: stripe-subscription-renewal", () => {
  it("naive example fails with expected entitlement duplication message", async () => {
    const app = await startNaiveExample();
    try {
      const runner = createScenarioRunner();
      const scenario = await runner.runStripeSubscriptionRenewal({
        targetWebhookUrl: `${app.baseUrl}/webhooks/stripe`,
        webhookSecret: app.webhookSecret,
        ids,
        seed: 1337,
      });

      expect(scenario.deliveries.some((row) => row.statusCode >= 500)).toBe(false);

      const verify = await runVerifyScript({
        exampleDir: join(examplesRoot, "stripe-express-naive"),
        customerId: ids.customer,
        baseUrl: app.baseUrl,
      });

      expect(verify.exitCode).not.toBe(0);
      const checks = parseChecks(verify.stdout);
      const renewal = checks.find((row) => row.name === "renewal_entitlements");
      expect(renewal).toBeDefined();
      expect(renewal?.pass).toBe(false);
      expect(renewal?.expected).toBe("1");
      expect(renewal?.observed).toBe("2");
      expect(renewal?.message).toBe(
        "Duplicate invoice.paid delivery created two entitlement records.",
      );
    } finally {
      await app.close();
    }
  });

  it("correct example passes verify after the same scenario", async () => {
    const app = await startCorrectExample();
    try {
      const runner = createScenarioRunner();
      const scenario = await runner.runStripeSubscriptionRenewal({
        targetWebhookUrl: `${app.baseUrl}/webhooks/stripe`,
        webhookSecret: app.webhookSecret,
        ids,
        seed: 1337,
      });

      const failedDeliveries = scenario.deliveries.filter((row) => row.statusCode >= 400);
      expect(failedDeliveries).toEqual([]);

      const verify = await runVerifyScript({
        exampleDir: join(examplesRoot, "stripe-express-correct"),
        customerId: ids.customer,
        baseUrl: app.baseUrl,
      });

      expect(verify.exitCode).toBe(0);
      const checks = parseChecks(verify.stdout);
      expect(checks.every((row) => row.pass)).toBe(true);
    } finally {
      await app.close();
    }
  });
});
