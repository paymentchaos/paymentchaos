import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ExitCode,
  PaymentChaosError,
  type ProviderAdapter,
  type Scenario,
  scenarioSchema,
} from "@paymentchaos/core";
import { createFakeProvider, startRecordingServer } from "@paymentchaos/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createCoreEngine } from "../src/engine/core-engine.ts";
import type { ProviderRegistry } from "../src/engine/registry.ts";
import { exitCodeFor, exitCodeForReport } from "../src/exit.ts";

const env = { FAKE_SECRET: "whsec_cli_engine_test" };

const STRIPE_LIKE_FLOWS = {
  "subscription-renewal": ["invoice.paid", "customer.subscription.updated"],
  "cancellation-renewal-out-of-order": [
    "invoice.paid",
    "customer.subscription.updated",
    "customer.subscription.deleted",
  ],
  "one-time-payment": ["payment_intent.succeeded", "checkout.session.completed"],
} as const;

function testRegistry(adapter: ProviderAdapter): ProviderRegistry {
  return {
    getAdapter(providerId: string) {
      if (providerId !== adapter.id) {
        throw new PaymentChaosError("CONFIG_INVALID", `missing ${providerId}`);
      }
      return adapter;
    },
    listFlows(providerFilter?: string) {
      if (providerFilter !== undefined && providerFilter !== adapter.id) {
        return [];
      }
      return adapter.flows.map((flow) => ({
        provider: adapter.id,
        id: flow.id,
        title: flow.title,
        events: flow.events,
      }));
    },
  };
}

const baseScenario = (url: string, overrides: Partial<Scenario> = {}): Scenario =>
  scenarioSchema.parse({
    version: 1,
    name: "cli engine integration",
    provider: "fake",
    flow: "subscription-renewal",
    target: { url, secret: "${FAKE_SECRET}" },
    chaos: [{ duplicate: { event: "invoice.paid", times: 1 } }],
    repeat: 1,
    ...overrides,
  });

describe("core engine integration", () => {
  let server: Awaited<ReturnType<typeof startRecordingServer>> | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("dispatches signed deliveries to the target", async () => {
    server = await startRecordingServer();
    const adapter = createFakeProvider({ env, flows: STRIPE_LIKE_FLOWS });
    const engine = createCoreEngine(testRegistry(adapter));
    const outcome = await engine.run({
      scenario: baseScenario(server.url),
      cwd: process.cwd(),
      seed: 42,
      repeat: 1,
      env,
    });

    expect(server.requests.length).toBeGreaterThan(0);
    expect(outcome.report.status).toBe("passed");
    expect(exitCodeForReport(outcome.report)).toBe(ExitCode.Ok);
  });

  it("maps unreachable targets to exit code 3", async () => {
    const adapter = createFakeProvider({ env, flows: STRIPE_LIKE_FLOWS });
    const engine = createCoreEngine(testRegistry(adapter));
    await expect(
      engine.run({
        scenario: baseScenario("http://127.0.0.1:1/unreachable"),
        cwd: process.cwd(),
        seed: 1,
        repeat: 1,
        env,
      }),
    ).rejects.toMatchObject({ code: "TARGET_UNREACHABLE" });
  });

  it("maps assertion failures to exit code 1", async () => {
    server = await startRecordingServer((_req, res) => {
      res.writeHead(500).end();
    });
    const adapter = createFakeProvider({ env, flows: STRIPE_LIKE_FLOWS });
    const engine = createCoreEngine(testRegistry(adapter));
    const outcome = await engine.run({
      scenario: baseScenario(server.url),
      cwd: process.cwd(),
      seed: 2,
      repeat: 1,
      env,
    });
    expect(outcome.report.status).toBe("failed");
    expect(exitCodeForReport(outcome.report)).toBe(ExitCode.AssertionFailed);
  });

  it("maps config errors to exit code 2", () => {
    expect(exitCodeFor(new PaymentChaosError("CONFIG_INVALID", "bad"))).toBe(ExitCode.Config);
  });

  it("rejects repeat-index above the effective repeat count", async () => {
    const adapter = createFakeProvider({ env, flows: STRIPE_LIKE_FLOWS });
    const engine = createCoreEngine(testRegistry(adapter));
    await expect(
      engine.run({
        scenario: baseScenario("http://127.0.0.1:9/hook"),
        cwd: process.cwd(),
        seed: 1,
        repeat: 3,
        repeatIndex: 4,
        env,
      }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });

  it("compiles a deterministic plan without contacting the target", async () => {
    const adapter = createFakeProvider({ env, flows: STRIPE_LIKE_FLOWS });
    const engine = createCoreEngine(testRegistry(adapter));
    const scenario = baseScenario("http://127.0.0.1:9/ignored", {
      flow: "cancellation-renewal-out-of-order",
      chaos: [
        {
          reorder: [
            "invoice.paid",
            "customer.subscription.updated",
            "customer.subscription.deleted",
          ],
        },
      ],
    });
    const first = await engine.plan({ scenario, seed: 99 });
    const second = await engine.plan({ scenario, seed: 99 });
    expect(first.planHash).toBe(second.planHash);
    expect(first.deliveries.map((d) => d.event.type)).toEqual([
      "invoice.paid",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ]);
  });
});

describe("CLI subprocess config errors", () => {
  const dir = mkdtempSync(join(tmpdir(), "paymentchaos-cli-config-"));

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads invalid scenario YAML with config exit semantics", async () => {
    const file = join(dir, "bad.yaml");
    writeFileSync(
      file,
      `version: 1
name: bad
provider: stripe
flow: subscription-renewal
target:
  url: http://127.0.0.1:3000/hook
  secret: sk_live_nope
`,
      "utf8",
    );
    const { loadScenarioFile } = await import("../src/yaml/load.ts");
    await expect(loadScenarioFile(file)).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    try {
      await loadScenarioFile(file);
    } catch (error) {
      expect(exitCodeFor(error)).toBe(ExitCode.Config);
    }
  });
});
