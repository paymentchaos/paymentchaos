import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startExample as startCorrectExample } from "@paymentchaos/example-stripe-express-correct/boot";
import { startExample as startNaiveExample } from "@paymentchaos/example-stripe-express-naive/boot";
import { describe, expect, it } from "vitest";
import { STRIPE_SUBSCRIPTION_RENEWAL } from "../src/builtin-scenarios.js";
import { compiledIds, countDeliveriesForEvent } from "../src/expected-deliveries.js";
import { loadStripeAdapter } from "../src/load-adapter.js";
import { parseChecks, runVerifyScript } from "../src/run-verify.js";
import { createScenarioRunner } from "../src/scenario-runner.js";

const examplesRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const seed = 1337;

describe("golden end-to-end: stripe-subscription-renewal", () => {
  it("naive example fails with expected duplicate entitlement count", async () => {
    const adapter = await loadStripeAdapter();
    const invoicePaidDeliveries = countDeliveriesForEvent(
      adapter,
      STRIPE_SUBSCRIPTION_RENEWAL,
      seed,
      "invoice.paid",
    );
    expect(invoicePaidDeliveries).toBe(5);

    const app = await startNaiveExample();
    try {
      const runner = createScenarioRunner();
      const scenario = await runner.runStripeSubscriptionRenewal({
        targetWebhookUrl: `${app.baseUrl}/webhooks/stripe`,
        webhookSecret: app.webhookSecret,
        seed,
      });

      expect(scenario.deliveries.some((row) => row.statusCode >= 500)).toBe(false);
      expect(scenario.deliveries.filter((row) => row.eventType === "invoice.paid")).toHaveLength(
        invoicePaidDeliveries,
      );

      const ids = compiledIds(adapter, STRIPE_SUBSCRIPTION_RENEWAL, seed);
      expect(ids.customer).toMatch(/^cus_/);
      const stripeCustomer = ids.customer as string;

      const verify = await runVerifyScript({
        exampleDir: join(examplesRoot, "stripe-express-naive"),
        customerId: stripeCustomer,
        baseUrl: app.baseUrl,
        env: {
          ...(ids.subscription === undefined
            ? {}
            : { PAYMENTCHAOS_ID_SUBSCRIPTION: ids.subscription }),
        },
      });

      expect(verify.exitCode).not.toBe(0);
      const checks = parseChecks(verify.stdout);
      const renewal = checks.find((row) => row.name === "renewal_entitlements");
      expect(renewal).toBeDefined();
      expect(renewal?.pass).toBe(false);
      expect(renewal?.expected).toBe("1");
      expect(renewal?.observed).toBe(String(invoicePaidDeliveries));
      expect(renewal?.message).toContain(String(invoicePaidDeliveries));

      const entitlementRows = app.db
        .prepare("SELECT COUNT(*) AS n FROM entitlements WHERE kind = 'renewal'")
        .get() as { n: number };
      expect(entitlementRows.n).toBe(invoicePaidDeliveries);
    } finally {
      await app.close();
    }
  });

  it("correct example passes verify after the same scenario", async () => {
    const adapter = await loadStripeAdapter();
    const app = await startCorrectExample();
    try {
      const runner = createScenarioRunner();
      const scenario = await runner.runStripeSubscriptionRenewal({
        targetWebhookUrl: `${app.baseUrl}/webhooks/stripe`,
        webhookSecret: app.webhookSecret,
        seed,
      });

      const failedDeliveries = scenario.deliveries.filter((row) => row.statusCode >= 400);
      expect(failedDeliveries).toEqual([]);

      const ids = compiledIds(adapter, STRIPE_SUBSCRIPTION_RENEWAL, seed);
      expect(ids.customer).toBeDefined();
      const verify = await runVerifyScript({
        exampleDir: join(examplesRoot, "stripe-express-correct"),
        customerId: ids.customer as string,
        baseUrl: app.baseUrl,
        env: {
          ...(ids.subscription === undefined
            ? {}
            : { PAYMENTCHAOS_ID_SUBSCRIPTION: ids.subscription }),
        },
      });

      expect(verify.exitCode).toBe(0);
      const checks = parseChecks(verify.stdout);
      expect(checks.every((row) => row.pass)).toBe(true);

      const accepted = scenario.deliveries.filter((row) => row.statusCode < 400).length;
      expect(accepted).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});
