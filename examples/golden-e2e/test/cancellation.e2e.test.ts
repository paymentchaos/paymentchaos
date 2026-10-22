import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startExample as startCorrectExample } from "@paymentchaos/example-stripe-express-correct/boot";
import { startExample as startNaiveExample } from "@paymentchaos/example-stripe-express-naive/boot";
import { describe, expect, it } from "vitest";
import { STRIPE_CANCELLATION_OUT_OF_ORDER } from "../src/builtin-scenarios.js";
import { compiledIds } from "../src/expected-deliveries.js";
import { loadStripeAdapter } from "../src/load-adapter.js";
import { runGoldenScenario } from "../src/run-scenario.js";
import { parseChecks, runVerifyScript } from "../src/run-verify.js";

const examplesRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const seed = 1337;

describe("golden end-to-end: stripe-cancellation-out-of-order", () => {
  it("naive app leaves subscription canceled or wrong subscription id", async () => {
    const adapter = await loadStripeAdapter();
    const ids = compiledIds(adapter, STRIPE_CANCELLATION_OUT_OF_ORDER, seed);
    const app = await startNaiveExample();
    try {
      await runGoldenScenario({
        scenario: STRIPE_CANCELLATION_OUT_OF_ORDER,
        seed,
        targetWebhookUrl: `${app.baseUrl}/webhooks/stripe`,
        webhookSecret: app.webhookSecret,
      });

      expect(ids.customer).toBeDefined();
      const verify = await runVerifyScript({
        exampleDir: join(examplesRoot, "stripe-express-naive"),
        customerId: ids.customer as string,
        baseUrl: app.baseUrl,
        env: {
          ...(ids.subscription === undefined
            ? {}
            : { PAYMENTCHAOS_ID_SUBSCRIPTION: ids.subscription }),
        },
      });

      expect(verify.exitCode).not.toBe(0);
      const checks = parseChecks(verify.stdout);
      const active = checks.find((row) => row.name === "subscription_active");
      const subId = checks.find((row) => row.name === "subscription_stripe_id");
      expect(active?.pass === false || subId?.pass === false).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("correct app stays active on the renewed subscription id", async () => {
    const adapter = await loadStripeAdapter();
    const ids = compiledIds(adapter, STRIPE_CANCELLATION_OUT_OF_ORDER, seed);
    expect(ids.subscription_2).toBeDefined();

    const app = await startCorrectExample();
    try {
      await runGoldenScenario({
        scenario: STRIPE_CANCELLATION_OUT_OF_ORDER,
        seed,
        targetWebhookUrl: `${app.baseUrl}/webhooks/stripe`,
        webhookSecret: app.webhookSecret,
      });

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
      const rows = app.db
        .prepare("SELECT stripe_subscription_id, status FROM stripe_subscriptions")
        .all() as Array<{ stripe_subscription_id: string; status: string }>;
      const statusById = Object.fromEntries(
        rows.map((row) => [row.stripe_subscription_id, row.status]),
      );
      expect(statusById[ids.subscription as string]).toBe("active");
      expect(statusById[ids.subscription_2 as string]).toBe("canceled");
    } finally {
      await app.close();
    }
  });
});
