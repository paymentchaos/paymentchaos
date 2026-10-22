import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startExample as startCorrectExample } from "@paymentchaos/example-stripe-express-correct/boot";
import { startExample as startNaiveExample } from "@paymentchaos/example-stripe-express-naive/boot";
import { STRIPE_SUBSCRIPTION_RENEWAL } from "./builtin-scenarios.js";
import { createCliScenarioRunner } from "./cli-scenario-runner.js";
import { compiledIds } from "./expected-deliveries.js";
import { loadStripeAdapter } from "./load-adapter.js";
import { runGoldenScenario } from "./run-scenario.js";
import { runVerifyScript } from "./run-verify.js";

const goldenRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const examplesRoot = join(goldenRoot, "..");
const seed = 1337;
const cliBuilt = existsSync(join(goldenRoot, "..", "..", "packages", "cli", "dist", "bin.js"));

async function runVariant(label: "naive" | "correct"): Promise<number> {
  const exampleDir = join(
    examplesRoot,
    label === "naive" ? "stripe-express-naive" : "stripe-express-correct",
  );
  const start = label === "naive" ? startNaiveExample : startCorrectExample;
  const app = await start();
  try {
    const adapter = await loadStripeAdapter();
    const ids = compiledIds(adapter, STRIPE_SUBSCRIPTION_RENEWAL, seed);

    if (cliBuilt && process.env.GOLDEN_E2E_DEMO_ENGINE !== "core") {
      const cli = createCliScenarioRunner({ exampleDir });
      const cliResult = await cli.runStripeSubscriptionRenewal({
        targetWebhookUrl: `${app.baseUrl}/webhooks/stripe`,
        webhookSecret: app.webhookSecret,
        seed,
      });
      process.stdout.write(cliResult.stdout);
      return cliResult.exitCode;
    }

    await runGoldenScenario({
      scenario: STRIPE_SUBSCRIPTION_RENEWAL,
      seed,
      targetWebhookUrl: `${app.baseUrl}/webhooks/stripe`,
      webhookSecret: app.webhookSecret,
    });

    if (ids.customer === undefined) {
      throw new Error("compiled plan missing customer id");
    }
    const verify = await runVerifyScript({
      exampleDir,
      customerId: ids.customer,
      baseUrl: app.baseUrl,
      env: {
        ...(ids.subscription === undefined
          ? {}
          : { PAYMENTCHAOS_ID_SUBSCRIPTION: ids.subscription }),
      },
    });
    process.stdout.write(verify.stdout);
    if (verify.stderr) {
      process.stderr.write(verify.stderr);
    }
    return verify.exitCode ?? 1;
  } finally {
    await app.close();
  }
}

async function main(): Promise<void> {
  process.stdout.write(
    `PaymentChaos golden demo (seed=${seed}, engine=${cliBuilt ? "cli" : "core"})\n\n`,
  );

  process.stdout.write("=== stripe-express-naive (expect business failure) ===\n");
  const naiveExit = await runVariant("naive");
  const naivePass = naiveExit !== 0;
  process.stdout.write(
    `naive exit ${naiveExit} ${naivePass ? "(expected)" : "(UNEXPECTED PASS)"}\n\n`,
  );

  process.stdout.write("=== stripe-express-correct (expect pass) ===\n");
  const correctExit = await runVariant("correct");
  process.stdout.write(
    `correct exit ${correctExit} ${correctExit === 0 ? "(expected)" : "(FAIL)"}\n`,
  );

  if (!naivePass || correctExit !== 0) {
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.stderr.write("\n");
  process.exit(1);
});
