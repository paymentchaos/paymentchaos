import { describe, expect, it } from "vitest";
import {
  asInstant,
  asSecretRef,
  type ChaosOperator,
  commandResultSchema,
  ExitCode,
  exitCodeFor,
  minorUnitExponent,
  minorUnitsPerMajor,
  PaymentChaosError,
  type ProviderAdapter,
  projectConfigSchema,
  SECRET_REF_PATTERN,
  scenarioSchema,
  secretEnvName,
} from "../index.ts";

describe("money", () => {
  it("knows zero-, two- and three-decimal currencies", () => {
    expect(minorUnitExponent("JPY")).toBe(0);
    expect(minorUnitExponent("usd")).toBe(2);
    expect(minorUnitExponent("BHD")).toBe(3);
    expect(minorUnitsPerMajor("JPY")).toBe(1);
    expect(minorUnitsPerMajor("USD")).toBe(100);
    expect(minorUnitsPerMajor("BHD")).toBe(1000);
  });
});

describe("secret references", () => {
  it("matches ${ENV_VAR} and extracts the name", () => {
    expect(SECRET_REF_PATTERN.test("${STRIPE_WEBHOOK_SECRET}")).toBe(true);
    expect(SECRET_REF_PATTERN.test("sk_live_literal")).toBe(false);
    expect(secretEnvName(asSecretRef("${STRIPE_WEBHOOK_SECRET}"))).toBe("STRIPE_WEBHOOK_SECRET");
  });
});

describe("errors", () => {
  it("maps error codes to stable exit codes", () => {
    const err = new PaymentChaosError("REMOTE_TARGET_BLOCKED", "blocked");
    expect(err.exitCode).toBe(ExitCode.Config);
    expect(exitCodeFor(err)).toBe(ExitCode.Config);
    expect(exitCodeFor(new Error("other"))).toBe(ExitCode.Internal);
  });

  it("never requires details and preserves cause", () => {
    const err = new PaymentChaosError("INTERNAL", "boom", { cause: new Error("root") });
    expect(err.details).toBeUndefined();
    expect(err.cause).toBeInstanceOf(Error);
  });
});

describe("scenario schema", () => {
  it("parses a minimal scenario and applies defaults", () => {
    const parsed = scenarioSchema.parse({
      version: 1,
      name: "renewal",
      provider: "stripe",
      flow: "subscription-renewal",
    });
    expect(parsed.chaos).toEqual([]);
    expect(parsed.repeat).toBe(1);
  });

  it("parses the documented chaos operators", () => {
    const parsed = scenarioSchema.parse({
      version: 1,
      name: "renewal survives chaos",
      provider: "stripe",
      flow: "subscription-renewal",
      chaos: [
        { duplicate: { event: "invoice.paid", times: 2 } },
        { reorder: ["invoice.paid", "customer.subscription.updated"] },
        { delay: { event: "invoice.paid", byMs: 50 } },
        { concurrent: { event: "invoice.paid", deliveries: 3 } },
      ],
      assert: { command: "npm run verify", settle: { timeoutMs: 5000, intervalMs: 250 } },
      seed: 1337,
    });
    expect(parsed.chaos).toHaveLength(4);
  });

  it("rejects a literal secret in target", () => {
    const result = scenarioSchema.safeParse({
      version: 1,
      name: "bad",
      provider: "stripe",
      flow: "x",
      target: { url: "http://localhost:3000/hook", secret: "sk_live_nope" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown top-level keys", () => {
    const result = scenarioSchema.safeParse({
      version: 1,
      name: "bad",
      provider: "stripe",
      flow: "x",
      typo: true,
    });
    expect(result.success).toBe(false);
  });
});

describe("project config schema", () => {
  it("parses per-provider targets", () => {
    const cfg = projectConfigSchema.parse({
      version: 1,
      providers: {
        stripe: { target: { url: "http://localhost:3000/webhooks/stripe", secret: "${S}" } },
      },
      hooks: { beforeEach: "npm run reset" },
    });
    expect(cfg.providers?.stripe?.target.url).toContain("stripe");
  });
});

describe("command result schema", () => {
  it("parses the optional rich-reporting document", () => {
    const parsed = commandResultSchema.parse({
      checks: [{ name: "entitlements", pass: false, expected: 1, observed: 2 }],
    });
    expect(parsed.checks[0]?.pass).toBe(false);
  });
});

describe("type-level contract conformance", () => {
  it("lets a fake provider satisfy ProviderAdapter and a value satisfy ChaosOperator", () => {
    // `satisfies` makes this a compile-time proof: the file only typechecks if the
    // fake structurally matches the frozen interface. See AGENTS.md package ownership.
    const fake = {
      id: "fake",
      displayName: "Fake",
      apiVersions: ["2026-01-01"],
      flows: [{ id: "f", title: "Flow", events: ["a.b"] }],
      deliveryProfile: {
        timeoutMillis: 20000,
        retryScheduleMillis: [1000],
        acceptedStatuses: [200],
        timestampFormat: "unix-seconds",
      },
      redactionRules: [],
      generate: () => [],
      encode: () => Buffer.from(""),
      sign: (d) => ({ body: d.body, headers: d.headers }),
      verify: () => ({ valid: true }),
      identify: () => null,
    } satisfies ProviderAdapter;

    const op = { duplicate: { event: "invoice.paid", times: 1 } } satisfies ChaosOperator;

    expect(fake.id).toBe("fake");
    expect("duplicate" in op).toBe(true);
    expect(asInstant(0)).toBe(0);
  });
});
