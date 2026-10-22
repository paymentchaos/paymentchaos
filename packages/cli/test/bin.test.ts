import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ExitCode } from "@paymentchaos/core";
import { beforeAll, describe, expect, it } from "vitest";
import { createProviderRegistry } from "../src/engine/registry.ts";

const pkgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const binJs = path.join(pkgRoot, "dist/bin.js");
const fixturesDir = path.join(pkgRoot, "test/fixtures");

function runBin(args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv }) {
  return spawnSync(process.execPath, [binJs, ...args], {
    cwd: opts?.cwd ?? pkgRoot,
    env: { ...process.env, ...opts?.env },
    encoding: "utf8",
  });
}

let stripeAvailable = false;

beforeAll(async () => {
  execSync("pnpm run build", { cwd: pkgRoot, stdio: "pipe" });
  const registry = await createProviderRegistry();
  stripeAvailable = registry.listFlows("stripe").length > 0;
});

describe("paymentchaos bin", () => {
  it("exits 2 when run is invoked without scenarios", () => {
    const result = runBin(["run"]);
    expect(result.status).toBe(ExitCode.Config);
    expect(result.stderr).toMatch(/Provide at least one scenario/);
    expect(result.stderr).not.toMatch(/secret|sk_/i);
  });

  it("exits 2 for invalid scenario YAML via plan", () => {
    const file = path.join(fixturesDir, "invalid-secret.yaml");
    const result = runBin(["plan", file]);
    expect(result.status).toBe(ExitCode.Config);
    expect(result.stderr).toMatch(/invalid-secret\.yaml:/);
    expect(result.stderr).not.toMatch(/sk_live/);
  });

  it("exits 2 for non-numeric --repeat", () => {
    const result = runBin(["run", "stripe-subscription-renewal", "--repeat", "12abc"]);
    expect(result.status).toBe(ExitCode.Config);
    expect(result.stderr).toMatch(/Invalid value/);
  });

  it("exits 2 when the stripe provider package is not installed", () => {
    if (stripeAvailable) {
      return;
    }
    const dir = mkdtempSync(path.join(tmpdir(), "paymentchaos-bin-no-stripe-"));
    try {
      writeFileSync(
        path.join(dir, "scenario.yaml"),
        `version: 1
name: needs-stripe
provider: stripe
flow: subscription-renewal
target:
  url: http://127.0.0.1:9/webhooks/stripe
  secret: \${STRIPE_WEBHOOK_SECRET}
`,
        "utf8",
      );
      const result = runBin(["plan", "scenario.yaml", "--seed", "1"], {
        cwd: dir,
        env: { STRIPE_WEBHOOK_SECRET: "whsec_test" },
      });
      expect(result.status).toBe(ExitCode.Config);
      expect(result.stderr).toMatch(/not installed/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 2 when the webhook secret env var is missing", () => {
    if (!stripeAvailable) {
      return;
    }
    const dir = mkdtempSync(path.join(tmpdir(), "paymentchaos-bin-secret-"));
    try {
      writeFileSync(
        path.join(dir, "paymentchaos.config.yaml"),
        `version: 1
providers:
  stripe:
    target:
      url: http://127.0.0.1:9/webhooks/stripe
      secret: \${STRIPE_WEBHOOK_SECRET}
`,
        "utf8",
      );
      mkdirSync(path.join(dir, "paymentchaos", "scenarios"), { recursive: true });
      writeFileSync(
        path.join(dir, "paymentchaos", "scenarios", "tiny.yaml"),
        `version: 1
name: tiny
provider: stripe
flow: subscription-renewal
`,
        "utf8",
      );
      const result = runBin(["run", "paymentchaos/scenarios/tiny.yaml"], {
        cwd: dir,
        env: { STRIPE_WEBHOOK_SECRET: "" },
      });
      expect(result.status).toBe(ExitCode.Config);
      expect(result.stderr).toMatch(/STRIPE_WEBHOOK_SECRET|secret/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 3 when the target is unreachable", () => {
    if (!stripeAvailable) {
      return;
    }
    const dir = mkdtempSync(path.join(tmpdir(), "paymentchaos-bin-down-"));
    try {
      writeFileSync(
        path.join(dir, "paymentchaos.config.yaml"),
        `version: 1
providers:
  stripe:
    target:
      url: http://127.0.0.1:1/webhooks/stripe
      secret: \${STRIPE_WEBHOOK_SECRET}
`,
        "utf8",
      );
      mkdirSync(path.join(dir, "paymentchaos", "scenarios"), { recursive: true });
      writeFileSync(
        path.join(dir, "paymentchaos", "scenarios", "tiny.yaml"),
        `version: 1
name: tiny
provider: stripe
flow: subscription-renewal
`,
        "utf8",
      );
      const result = runBin(["run", "paymentchaos/scenarios/tiny.yaml", "--seed", "1"], {
        cwd: dir,
        env: { STRIPE_WEBHOOK_SECRET: "whsec_bin_unreachable_test" },
      });
      expect(result.status).toBe(ExitCode.TargetUnreachable);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
