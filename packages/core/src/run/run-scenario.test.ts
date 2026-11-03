import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  type ChaosOperator,
  PaymentChaosError,
  runReportSchema,
  type Scenario,
  scenarioSchema,
} from "../contracts/index.ts";
import { createFakeProvider } from "../testing/fake-provider.ts";
import { type RecordingServer, startRecordingServer } from "../testing/recording-server.ts";
import { type RunEvent, runScenario } from "./run-scenario.ts";

const env = { FAKE_SECRET: "whsec_run_test" };
const adapter = createFakeProvider({ env });
const dir = mkdtempSync(join(tmpdir(), "paymentchaos-run-"));
const stateFile = join(dir, "grants.json");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const node = (file: string, ...args: string[]) =>
  [process.execPath, file, ...args].map((part) => `"${part}"`).join(" ");
const writeScript = (name: string, source: string) => {
  const file = join(dir, name);
  writeFileSync(file, source);
  return file;
};

/** Resets app state, like `npm run test:reset-db`. */
const reset = node(
  writeScript(
    "reset.mjs",
    `import { writeFileSync } from "node:fs";
     writeFileSync(process.argv[2], JSON.stringify({ grants: {}, processed: [] }));`,
  ),
  stateFile,
);
/** Checks one grant per invoice, printing the JSON protocol, like `npm run verify`. */
const verify = node(
  writeScript(
    "verify.mjs",
    `import { readFileSync } from "node:fs";
     const { grants } = JSON.parse(readFileSync(process.argv[2], "utf8"));
     const invoice = JSON.parse(process.env.PAYMENTCHAOS_IDS_JSON).invoice;
     const observed = grants[invoice] ?? 0;
     console.log(JSON.stringify({ checks: [{ name: "one entitlement per invoice", pass: observed === 1, expected: 1, observed }] }));
     process.exit(observed === 1 ? 0 : 1);`,
  ),
  stateFile,
);

interface AppState {
  grants: Record<string, number>;
  processed: string[];
}
const load = () => JSON.parse(readFileSync(stateFile, "utf8")) as AppState;

/**
 * A tiny webhook app that grants one entitlement per paid invoice, idempotent on event
 * id. The naive variant awaits between "check" and "insert": the classic race.
 */
function app(atomic: boolean) {
  return async (req: { body: Buffer }, res: { writeHead(code: number): { end(): void } }) => {
    const event = JSON.parse(req.body.toString("utf8")) as {
      id: string;
      type: string;
      data: { object: { invoice: string } };
    };
    if (event.type === "invoice.paid" && !load().processed.includes(event.id)) {
      if (!atomic) await sleep(20);
      const state = load();
      const invoice = event.data.object.invoice;
      state.grants[invoice] = (state.grants[invoice] ?? 0) + 1;
      state.processed.push(event.id);
      writeFileSync(stateFile, JSON.stringify(state));
    }
    res.writeHead(200).end();
  };
}

let server: RecordingServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const scenario = (
  url: string,
  chaos: ChaosOperator[],
  overrides: Partial<Scenario> = {},
): Scenario =>
  scenarioSchema.parse({
    version: 1,
    name: "renewal survives chaos",
    provider: "fake",
    flow: "subscription-renewal",
    params: { currency: "inr" },
    target: { url, secret: "${FAKE_SECRET}" },
    hooks: { beforeEach: reset },
    assert: { command: verify, settle: { timeoutMs: 2000, intervalMs: 50 } },
    chaos,
    ...overrides,
  });

const chaos: ChaosOperator[] = [
  { duplicate: { event: "invoice.paid", times: 2 } },
  { reorder: ["customer.subscription.updated", "invoice.paid"] },
  { concurrent: { event: "invoice.paid", deliveries: 3 } },
];

describe("runScenario", () => {
  it.each([false, true])(
    "rejects HTTP assertions before side effects (command: %s)",
    async (withCommand) => {
      server = await startRecordingServer();
      const marker = join(dir, `http-assert-${String(withCommand)}`);
      const command = node(
        writeScript(
          "http-assert-marker.mjs",
          `import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2], "ran");`,
        ),
        marker,
      );
      const events: RunEvent[] = [];
      const s = scenario(server.url, chaos, {
        hooks: { beforeEach: command, afterEach: command },
        assert: {
          http: { url: server.url, expect: { "$.entitlements": 1 } },
          ...(withCommand ? { command } : {}),
        },
      });
      await expect(
        runScenario(s, { adapter, env, onEvent: (event) => events.push(event) }),
      ).rejects.toMatchObject({
        code: "CONFIG_INVALID",
        message: expect.stringContaining("use assert.command"),
      });
      expect(existsSync(marker)).toBe(false);
      expect(server.requests).toHaveLength(0);
      expect(events).toEqual([]);
    },
  );

  it("passes a correct app and reports a schema-valid run", async () => {
    server = await startRecordingServer(app(true));
    const events: RunEvent["type"][] = [];
    const run = await runScenario(scenario(server.url, chaos), {
      adapter,
      env,
      seed: 1337,
      repeat: 2,
      runId: "run_fixed",
      onEvent: (e) => events.push(e.type),
    });
    expect(runReportSchema.parse(run.report)).toEqual(run.report);
    expect(run.report).toMatchObject({
      status: "passed",
      seed: 1337,
      repeat: 2,
      repeatsFailed: 0,
      runId: "run_fixed",
      provider: "fake",
    });
    expect(run.report.assertions.map((a) => [a.name, a.pass])).toEqual([
      ["every validly signed delivery is accepted", true],
      ["assert.command exits 0", true],
      ["one entitlement per invoice", true],
    ]);
    expect(run.notes.join(" ")).toMatch(/does not rule out/);
    expect(events.filter((t) => t === "delivery")).toHaveLength(2 * run.plan.deliveries.length);
    expect(events[0]).toBe("plan");
    // Fresh nonce per repetition: same plan hash, different ids on the wire.
    const [first, second] = run.repeats;
    expect(first?.ids.invoice).not.toBe(second?.ids.invoice);
  });

  it("catches a check-then-insert race and counts failed repetitions", async () => {
    server = await startRecordingServer(app(false));
    const quick = { command: verify, settle: { timeoutMs: 100, intervalMs: 50 } };
    const run = await runScenario(scenario(server.url, chaos, { assert: quick }), {
      adapter,
      env,
      seed: 7,
      repeat: 3,
    });
    expect(run.report.status).toBe("failed");
    expect(run.report.repeatsFailed).toBeGreaterThanOrEqual(1);
    const check = run.report.assertions.find((a) => a.name === "one entitlement per invoice");
    expect(check).toMatchObject({ pass: false, expected: 1 });
    expect(check?.observed).toBeGreaterThan(1);
  });

  it("fails the built-in check when the app rejects valid deliveries", async () => {
    server = await startRecordingServer((_req, res) => {
      res.writeHead(409).end();
    });
    const run = await runScenario(
      scenario(server.url, [], { assert: undefined, hooks: undefined }),
      { adapter, env, seed: 1 },
    );
    expect(run.report.status).toBe("failed");
    expect(run.report.assertions[0]?.message).toMatch(/HTTP 409/);
  });

  it("forwards the local request timeout to every delivery", async () => {
    server = await startRecordingServer(async (_req, res) => {
      await sleep(400);
      res.writeHead(200).end();
    });
    const run = await runScenario(
      scenario(server.url, [], { assert: undefined, hooks: undefined }),
      { adapter, env, seed: 1, timeoutMillis: 100 },
    );
    expect(run.report.status).toBe("failed");
    expect(run.report.deliveries.map((d) => d.error)).toEqual([
      "no response within 100 ms",
      "no response within 100 ms",
    ]);
  });

  it("rejects an invalid local timeout before secrets, hooks or sends", async () => {
    server = await startRecordingServer();
    const marker = join(dir, "timeout-hook-ran");
    const hook = node(
      writeScript(
        "mark-timeout.mjs",
        `import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2], "x");`,
      ),
      marker,
    );
    const s = scenario(server.url, [], { hooks: { beforeEach: hook } });
    await expect(runScenario(s, { adapter, env: {}, timeoutMillis: 0 })).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
    expect(existsSync(marker)).toBe(false);
    expect(server.requests).toHaveLength(0);
  });

  it("runs exactly the selected repetition with its index in hook and assert metadata", async () => {
    server = await startRecordingServer();
    const log = join(dir, "repeat-index.log");
    writeFileSync(log, "");
    const record = (phase: string) =>
      node(
        writeScript(
          `record-${phase}.mjs`,
          `import { appendFileSync } from "node:fs";
           appendFileSync(process.argv[2], "${phase}=" + process.env.PAYMENTCHAOS_REPEAT_INDEX + "\\n");`,
        ),
        log,
      );
    const events: string[] = [];
    const run = await runScenario(
      scenario(server.url, chaos, {
        hooks: { beforeEach: record("before"), afterEach: record("after") },
        assert: { command: record("assert") },
      }),
      {
        adapter,
        env,
        seed: 1337,
        repeat: 20,
        repeatIndex: 4,
        onEvent: (e) => {
          if (e.type !== "plan") events.push(`${e.type}:${String(e.index)}`);
        },
      },
    );
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
      "before=4",
      "assert=4",
      "after=4",
    ]);
    expect(server.requests).toHaveLength(run.plan.deliveries.length);
    expect(run.repeats.map((r) => r.index)).toEqual([4]);
    expect(new Set(events)).toEqual(new Set(["repeat-start:4", "delivery:4", "repeat-end:4"]));
    expect(run.report).toMatchObject({ status: "passed", repeat: 1, repeatsFailed: 0 });
    expect(run.notes.join(" ")).toMatch(/only repetition 4 of 20/);
  });

  it("counts only the executed repetition when the selected run fails", async () => {
    server = await startRecordingServer((_req, res) => {
      res.writeHead(409).end();
    });
    const run = await runScenario(
      scenario(server.url, [], { assert: undefined, hooks: undefined }),
      { adapter, env, seed: 1, repeat: 20, repeatIndex: 4 },
    );
    expect(run.report).toMatchObject({ status: "failed", repeat: 1, repeatsFailed: 1 });
    expect(run.notes.join(" ")).not.toMatch(/repetitions failed/);
  });

  it("keeps seed and plan hash, and ids with stableIds, for a selected repetition", async () => {
    server = await startRecordingServer();
    const s = scenario(server.url, chaos, { assert: undefined, hooks: undefined });
    const base = { adapter, env, seed: 9, repeat: 5 };
    const full = await runScenario(s, { ...base, stableIds: true });
    const one = await runScenario(s, { ...base, stableIds: true, repeatIndex: 4 });
    expect(one.report.planHash).toBe(full.report.planHash);
    expect(one.repeats[0]?.ids).toEqual(full.repeats[3]?.ids);
    const fresh = await runScenario(s, { ...base, repeatIndex: 4 });
    expect(fresh.report.planHash).toBe(full.report.planHash);
    expect(fresh.report.seed).toBe(9);
  });

  it("selects from a huge repeat without work proportional to it", async () => {
    server = await startRecordingServer();
    const s = scenario(server.url, [], { assert: undefined, hooks: undefined });
    const max = Number.MAX_SAFE_INTEGER;
    const run = await runScenario(s, { adapter, env, repeat: max, repeatIndex: max });
    expect(run.repeats.map((r) => r.index)).toEqual([max]);
    expect(server.requests).toHaveLength(run.plan.deliveries.length);
  });

  it.each([
    [2 ** 53, undefined],
    [2 ** 53, 1],
    [Number.POSITIVE_INFINITY, undefined],
  ])("rejects unsafe repeat %s (index %s) before hooks or sends", async (repeat, repeatIndex) => {
    server = await startRecordingServer();
    const s = scenario(server.url, [], { assert: undefined, hooks: undefined });
    await expect(
      runScenario(s, {
        adapter,
        env,
        repeat,
        ...(repeatIndex === undefined ? {} : { repeatIndex }),
      }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID", message: expect.stringMatching(/^repeat /) });
    expect(server.requests).toHaveLength(0);
  });

  it.each([
    [0, 20],
    [21, 20],
    [-1, 20],
    [1.5, 20],
    [Number.NaN, 20],
    [2, undefined],
  ])("rejects repeatIndex %s (repeat %s) before hooks or sends", async (repeatIndex, repeat) => {
    server = await startRecordingServer();
    const marker = join(dir, "repeat-index-hook-ran");
    const hook = node(
      writeScript(
        "mark-repeat-index.mjs",
        `import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2], "x");`,
      ),
      marker,
    );
    const s = scenario(server.url, [], { hooks: { beforeEach: hook } });
    await expect(
      runScenario(s, {
        adapter,
        env,
        repeatIndex,
        ...(repeat === undefined ? {} : { repeat }),
      }),
    ).rejects.toMatchObject({
      code: "CONFIG_INVALID",
      message: expect.stringContaining("--repeat-index"),
    });
    expect(existsSync(marker)).toBe(false);
    expect(server.requests).toHaveLength(0);
  });

  it("uses the same ids every repetition with stableIds", async () => {
    server = await startRecordingServer();
    const run = await runScenario(
      scenario(server.url, [], { assert: undefined, hooks: undefined }),
      {
        adapter,
        env,
        seed: 3,
        repeat: 2,
        stableIds: true,
      },
    );
    expect(run.repeats[0]?.ids).toEqual(run.repeats[1]?.ids);
  });

  it("prefers the explicit seed, then the scenario seed, then a random one", async () => {
    server = await startRecordingServer();
    const s = scenario(server.url, [], { assert: undefined, hooks: undefined, seed: 99 });
    expect((await runScenario(s, { adapter, env })).report.seed).toBe(99);
    expect((await runScenario(s, { adapter, env, seed: 5 })).report.seed).toBe(5);
    const { seed: _seed, ...unseeded } = s;
    expect(
      Number.isInteger((await runScenario(unseeded as Scenario, { adapter, env })).report.seed),
    ).toBe(true);
  });

  it("blocks a remote target before running any hook", async () => {
    const marker = join(dir, "hook-ran");
    const hook = node(
      writeScript(
        "mark.mjs",
        `import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2], "x");`,
      ),
      marker,
    );
    const s = scenario("https://hooks.example.com/stripe", [], { hooks: { beforeEach: hook } });
    await expect(runScenario(s, { adapter, env })).rejects.toMatchObject({
      code: "REMOTE_TARGET_BLOCKED",
    });
    expect(existsSync(marker)).toBe(false);
  });

  it("turns a failing hook into a config error", async () => {
    server = await startRecordingServer();
    const failing = node(writeScript("fail.mjs", `console.error("db locked"); process.exit(2);`));
    const s = scenario(server.url, [], { hooks: { beforeEach: failing } });
    await expect(runScenario(s, { adapter, env })).rejects.toThrow(
      /hooks.beforeEach.*exited with 2.*db locked/,
    );
    expect(server.requests).toHaveLength(0);
  });

  it("lets beforeEach start the app in the background and runs against it", async () => {
    // `npm start &` in a hook: the app inherits the hook's stdout and logs every request.
    const port = await new Promise<number>((resolve) => {
      const probe = createServer().listen(0, "127.0.0.1", () => {
        const { port } = probe.address() as AddressInfo;
        probe.close(() => resolve(port));
      });
    });
    const pidFile = join(dir, "bg-app.pid");
    const appScript = writeScript(
      "bg-app.mjs",
      `import { createServer } from "node:http";
       let received = 0;
       createServer((req, res) => {
         req.resume().on("end", () => {
           if (req.method === "POST") received++;
           console.log(req.method + " " + req.url);
           res.end(String(received));
         });
       }).listen(${port}, "127.0.0.1");
       setTimeout(() => process.exit(0), 60000);`,
    );
    const start = node(
      writeScript(
        "start-bg-app.mjs",
        `import { spawn } from "node:child_process";
         import { writeFileSync } from "node:fs";
         // On Windows, Node kills its own children when it exits (libuv job object); a shell's
         // \`start /b\` child would outlive it, so detach there to model that.
         const app = spawn(process.execPath, [process.argv[2]], {
           stdio: ["ignore", "inherit", "inherit"],
           detached: process.platform === "win32",
         });
         app.unref();
         writeFileSync(process.argv[3], String(app.pid));
         for (;;) {
           try { await fetch("http://127.0.0.1:${port}/ready"); break; }
           catch { await new Promise((r) => setTimeout(r, 50)); }
         }`,
      ),
      appScript,
      pidFile,
    );
    const count = node(
      writeScript(
        "count.mjs",
        `const n = Number(await (await fetch("http://127.0.0.1:${port}/count")).text());
         process.exit(n === 2 ? 0 : 1);`,
      ),
    );
    const s = scenario(`http://127.0.0.1:${port}/hook`, [], {
      hooks: { beforeEach: start },
      assert: { command: count },
    });
    const started = performance.now();
    try {
      const { report } = await runScenario(s, { adapter, env, commandTimeoutMs: 10_000 });
      expect(report.status).toBe("passed");
      expect(report.deliveries).toHaveLength(2);
      expect(performance.now() - started).toBeLessThan(8000);
    } finally {
      try {
        process.kill(Number(readFileSync(pidFile, "utf8")));
      } catch {
        // Already gone.
      }
    }
  });

  it("requires a target and a secret", async () => {
    const noTarget = scenario("http://localhost/", [], { target: undefined });
    await expect(runScenario(noTarget, { adapter, env })).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
    const noSecret = scenario("http://localhost/", [], { target: { url: "http://localhost/" } });
    await expect(runScenario(noSecret, { adapter, env })).rejects.toBeInstanceOf(PaymentChaosError);
    await expect(
      runScenario(scenario("http://localhost/", []), { adapter, env: {} }),
    ).rejects.toMatchObject({
      code: "SECRET_MISSING",
    });
  });
});
