import { execSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ExitCode, runReportSchema } from "@paymentchaos/core";
import { startRecordingServer } from "@paymentchaos/core/testing";
import { validateWebhookSignature } from "razorpay/dist/utils/razorpay-utils.js";
import { Webhook } from "standardwebhooks";
import { beforeAll, describe, expect, it } from "vitest";
import { stringify } from "yaml";
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

beforeAll(async () => {
  execSync("pnpm run build", { cwd: pkgRoot, stdio: "pipe" });
});

describe("paymentchaos bin", () => {
  it("accepts a separate negative seed exactly like the equals form", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "paymentchaos-negative-seed-"));
    try {
      writeFileSync(
        path.join(cwd, "paymentchaos.config.yaml"),
        stringify({
          version: 1,
          providers: { stripe: { target: { url: "http://127.0.0.1:9/webhook" } } },
        }),
      );
      const separate = runBin(["plan", "stripe-subscription-renewal", "--seed", "-1"], { cwd });
      const attached = runBin(["plan", "stripe-subscription-renewal", "--seed=-1"], { cwd });
      expect(separate.status, separate.stderr).toBe(ExitCode.Ok);
      expect(separate.stdout).toContain("seed -1");
      expect(separate.stdout).toBe(attached.stdout);
      expect(attached.status).toBe(ExitCode.Ok);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("prints help even when NODE_ENV=test silences citty's logger", () => {
    const top = runBin(["--help"], { env: { NODE_ENV: "test", NO_COLOR: "1" } });
    expect(top.status).toBe(ExitCode.Ok);
    expect(top.stdout).toContain("USAGE paymentchaos");
    const init = runBin(["init", "--help"], { env: { NODE_ENV: "test", NO_COLOR: "1" } });
    expect(init.stdout).toContain("--secret-env");
    const usageError = runBin(["bogus"], { env: { NODE_ENV: "test", NO_COLOR: "1" } });
    expect(usageError.status).toBe(ExitCode.Config);
    expect(usageError.stdout).toContain("USAGE paymentchaos init|run|plan|flows");
  });

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

  it("exits 2 when the webhook secret env var is missing", () => {
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

// Share the build above: these async CLI tests must not race another file rebuilding dist.
const secret = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;
function runProviderBin(args: string[], cwd: string) {
  return new Promise<{ code: number | null; output: string; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [binJs, ...args], {
        cwd,
        env: { ...process.env, PAYMENTCHAOS_TEST_SECRET: secret, NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, output, stdout, stderr }));
    },
  );
}

describe("built-in provider CLI integration", () => {
  it.each([
    ["razorpay-subscription-charged", "razorpay", ["subscription.charged"]],
    ["razorpay-payment-captured", "razorpay", ["order.paid", "payment.captured"]],
    ["generic-hmac-duplicate", "generic-hmac", ["custom.updated", "custom.created"]],
  ] as const)(
    "runs %s with every delivery verified by the official SDK",
    async (scenario, provider, types) => {
      const cwd = await mkdtemp(path.join(tmpdir(), "paymentchaos-provider-"));
      const seen: { id: string; type: string; body: Buffer }[] = [];
      const failures: string[] = [];
      const server = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks);
        const headers = Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [
            k,
            Array.isArray(v) ? v.join(",") : (v ?? ""),
          ]),
        );
        try {
          let id: string;
          let type: string;
          if (provider === "razorpay") {
            if (
              !validateWebhookSignature(
                body.toString("utf8"),
                headers["x-razorpay-signature"] ?? "",
                secret,
              )
            )
              throw new Error("SDK rejected Razorpay delivery");
            id = headers["x-razorpay-event-id"] ?? "";
            type = JSON.parse(body.toString("utf8")).event;
          } else {
            const parsed = new Webhook(secret).verify(body, headers) as { type: string };
            id = headers["webhook-id"] ?? "";
            type = parsed.type;
            if (headers["x-paymentchaos-mode"] !== "test") throw new Error("Missing test marker");
          }
          if (!id) throw new Error("Missing event identity");
          seen.push({ id, type, body });
          res.writeHead(200).end();
        } catch (error) {
          failures.push(String(error));
          res.writeHead(400).end();
        }
      });
      try {
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Missing server port");
        await writeFile(
          path.join(cwd, "paymentchaos.config.yaml"),
          stringify({
            version: 1,
            providers: {
              [provider]: {
                target: {
                  url: `http://127.0.0.1:${address.port}/webhooks`,
                  secret: "${PAYMENTCHAOS_TEST_SECRET}",
                },
              },
            },
          }),
        );
        const result = await runProviderBin(["run", scenario, "--seed", "1337"], cwd);
        expect(result, result.output).toMatchObject({ code: 0 });
        expect(failures).toEqual([]);
        expect([...new Set(seen.map((e) => e.type))]).toEqual(types);
        expect(seen.length).toBeGreaterThanOrEqual(provider === "generic-hmac" ? 4 : types.length);
        for (const id of new Set(seen.map((e) => e.id))) {
          const copies = seen.filter((e) => e.id === id);
          for (const copy of copies) expect(copy.body).toEqual(copies[0]?.body);
        }
        if (scenario !== "razorpay-payment-captured")
          expect(new Set(seen.map((e) => e.id)).size).toBeLessThan(seen.length);
        const flows = await runProviderBin(["flows"], cwd);
        expect(flows.code).toBe(0);
        expect(flows.output).toContain(
          provider === "generic-hmac" ? "user-event" : scenario.replace("razorpay-", ""),
        );
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        await rm(cwd, { recursive: true, force: true });
      }
    },
  );
  it("statically registers all three providers and configures generic payloads per scenario", async () => {
    const registry = await createProviderRegistry();
    expect(new Set(registry.listFlows().map((f) => f.provider))).toEqual(
      new Set(["stripe", "razorpay", "generic-hmac"]),
    );
    expect(() => registry.getAdapter("generic-hmac", { events: [] })).toThrowError(
      expect.objectContaining({ code: "CONFIG_INVALID" }),
    );
    expect(() => registry.getAdapter("unknown")).toThrowError(
      expect.objectContaining({ code: "CONFIG_INVALID" }),
    );
  });
});

// Exercise the built entry point: stdout must remain parseable even when checks fail.
describe("machine reports from the built CLI entry point", () => {
  it.each(["json", "junit"])(
    "writes complete %s reports for multiple scenarios, preserving exits and redaction",
    async (reporter) => {
      const cwd = await mkdtemp(path.join(tmpdir(), "paymentchaos reports café "));
      const server = await startRecordingServer();
      try {
        await writeFile(
          path.join(cwd, "paymentchaos.config.yaml"),
          stringify({
            version: 1,
            providers: {
              stripe: { target: { url: server.url, secret: "${PAYMENTCHAOS_TEST_SECRET}" } },
            },
          }),
        );
        await writeFile(
          path.join(cwd, "verify.cjs"),
          `console.log(JSON.stringify({checks:[{name:"余额 & balance",pass:false,expected:1,observed:{count:2,token:${JSON.stringify(secret)}}}]}));process.exitCode=1;`,
        );
        for (const name of ["good", "bad"]) {
          await writeFile(
            path.join(cwd, `${name}.yaml`),
            stringify({
              version: 1,
              name,
              provider: "stripe",
              flow: "subscription-renewal",
              assert: {
                command: name === "good" ? 'node -e "process.exit(0)"' : "node verify.cjs",
              },
            }),
          );
        }
        const args = ["--reporter", reporter, "--seed", "-1", "--repeat", "2"];
        const passed = await runProviderBin(["run", "good.yaml", ...args], cwd);
        expect(passed.code, passed.stderr).toBe(0);
        const out = "résultats.out";
        await writeFile(path.join(cwd, out), "old report");
        const failed = await runProviderBin(
          ["run", "good.yaml", "bad.yaml", ...args, "--out", out],
          cwd,
        );
        expect(failed.code, failed.stderr).toBe(1);
        expect(failed.stderr).toBe("");
        expect(failed.stdout).not.toContain(secret);
        expect(failed.stdout).toContain("[REDACTED]");
        expect(failed.stdout).not.toContain("PAYMENTCHAOS PASSED");
        expect(await readFile(path.join(cwd, out), "utf8")).toBe(failed.stdout);
        if (reporter === "json") {
          expect(runReportSchema.parse(JSON.parse(passed.stdout))).toMatchObject({
            status: "passed",
            repeat: 2,
            seed: -1,
          });
          const reports = (JSON.parse(failed.stdout) as unknown[]).map((report) =>
            runReportSchema.parse(report),
          );
          expect(reports.map((r) => [r.scenario, r.status, r.repeatsFailed])).toEqual([
            ["good", "passed", 0],
            ["bad", "failed", 2],
          ]);
          expect(reports[1]?.assertions.at(-1)).toMatchObject({
            observed: { count: 2, token: "[REDACTED]" },
          });
        } else {
          expect(passed.stdout).toContain('<testsuites tests="2" failures="0" errors="0"');
          expect(failed.stdout).toMatch(/^<\?xml.*<\/testsuites>\n$/s);
          expect(failed.stdout.match(/<testsuite /g)).toHaveLength(2);
          expect(failed.stdout).toContain('<testsuites tests="5" failures="2" errors="0"');
        }
        const writeFailed = await runProviderBin(
          ["run", "good.yaml", ...args, "--out", "missing/report.out"],
          cwd,
        );
        expect(writeFailed.code).toBe(2);
        expect(writeFailed.stderr).toContain("Could not write report");
        const aborted = await runProviderBin(
          ["run", "good.yaml", "absent.yaml", ...args, "--out", out],
          cwd,
        );
        expect(aborted.code).toBe(2);
        expect(aborted.stdout).toBe("");
        expect(await readFile(path.join(cwd, out), "utf8")).toBe(failed.stdout);
      } finally {
        await server.close();
        await rm(cwd, { recursive: true, force: true });
      }
    },
  );
});

describe("interrupting the built CLI", () => {
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  // POSIX only: Windows has no catchable SIGTERM, and Ctrl-C there reaches the whole console.
  it.skipIf(process.platform === "win32").each([
    ["SIGINT", "assert"],
    ["SIGTERM", "hook"],
  ] as const)(
    "%s stops the run and kills a running %s command's process tree",
    async (signal, where) => {
      const cwd = await mkdtemp(path.join(tmpdir(), "paymentchaos interrupt "));
      const server = await startRecordingServer();
      const pids = path.join(cwd, "pids.txt");
      // The command and a grandchild it starts both outlive a CLI that dies without cleanup.
      await writeFile(
        path.join(cwd, "slow.mjs"),
        `import { spawn } from "node:child_process";
       import { writeFileSync } from "node:fs";
       const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300000)"], { stdio: "ignore" });
       writeFileSync(${JSON.stringify(pids)}, process.pid + " " + sleeper.pid);
       setTimeout(() => {}, 300000);`,
      );
      const command = "node slow.mjs";
      try {
        await writeFile(
          path.join(cwd, "paymentchaos.config.yaml"),
          stringify({
            version: 1,
            providers: {
              stripe: { target: { url: server.url, secret: "${PAYMENTCHAOS_TEST_SECRET}" } },
            },
            ...(where === "hook" ? { hooks: { beforeEach: command } } : { assert: { command } }),
          }),
        );
        const child = spawn(process.execPath, [binJs, "run", "stripe-one-time-payment"], {
          cwd,
          env: { ...process.env, PAYMENTCHAOS_TEST_SECRET: secret, NO_COLOR: "1" },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stderr = "";
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        const exited = new Promise<[number | null, NodeJS.Signals | null]>((resolve) =>
          child.on("exit", (code, sig) => resolve([code, sig])),
        );
        let started: number[] = [];
        for (let i = 0; i < 200 && started.length < 2; i++) {
          await new Promise((r) => setTimeout(r, 50));
          started = await readFile(pids, "utf8").then(
            (text) => text.split(" ").map(Number),
            () => [],
          );
        }
        expect(started).toHaveLength(2);
        child.kill(signal);
        const [code, received] = await exited;
        expect([code, received]).toEqual([null, signal]);
        expect(stderr).toContain(`Interrupted by ${signal}`);
        await new Promise((r) => setTimeout(r, 200));
        expect(started.filter(alive)).toEqual([]);
        expect(server.requests).toHaveLength(where === "hook" ? 0 : 4);
      } finally {
        await server.close();
        await rm(cwd, { recursive: true, force: true });
      }
    },
  );
});
