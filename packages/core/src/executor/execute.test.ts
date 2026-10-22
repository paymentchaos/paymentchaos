import { setTimeout as sleep } from "node:timers/promises";
import { Agent, type Dispatcher } from "undici";
import { afterEach, describe, expect, it } from "vitest";
import {
  asInstant,
  asSecretRef,
  type ChaosOperator,
  PaymentChaosError,
  scenarioSchema,
} from "../contracts/index.ts";
import { compilePlan } from "../plan/compile.ts";
import { createFakeProvider, FAKE_SIGNATURE_HEADER } from "../testing/fake-provider.ts";
import {
  type RecordingHandler,
  type RecordingServer,
  startRecordingServer,
} from "../testing/recording-server.ts";
import { DEFAULT_REQUEST_TIMEOUT_MS, executePlan } from "./execute.ts";

const env = { FAKE_SECRET: "whsec_executor_test" };
const keys = { current: asSecretRef("${FAKE_SECRET}") };
const adapter = createFakeProvider({ env, timeoutMillis: 2000 });

const compile = (chaos: ChaosOperator[], flow = "subscription-renewal") =>
  compilePlan(
    scenarioSchema.parse({ version: 1, name: "t", provider: "fake", flow, chaos }),
    adapter,
    { seed: 42, nonce: "Exec0001" },
  );

let server: RecordingServer | undefined;
const serve = async (handler?: RecordingHandler) => {
  server = await startRecordingServer(handler);
  return server;
};
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PaymentChaosError) return error.code;
    throw error;
  }
  return "no error";
};

describe("executePlan", () => {
  it("sends every delivery in plan order with exact bytes and verifiable signatures", async () => {
    const target = await serve();
    const compiled = compile([{ duplicate: { event: "invoice.paid", times: 2 } }]);
    let clock = 1_800_000_000_000;
    const result = await executePlan(compiled, adapter, {
      url: target.url,
      keys,
      env,
      now: () => (clock += 1000),
    });

    expect(
      result.deliveries.map((d) => [d.seq, d.eventType, d.attempt, d.statusCode, d.accepted]),
    ).toEqual([
      [0, "invoice.paid", 1, 200, true],
      [1, "invoice.paid", 2, 200, true],
      [2, "invoice.paid", 3, 200, true],
      [3, "customer.subscription.updated", 1, 200, true],
    ]);
    expect(target.requests).toHaveLength(4);
    target.requests.forEach((req, i) => {
      const delivery = compiled.plan.deliveries[i];
      expect(req.method).toBe("POST");
      expect(req.headers["content-type"]).toBe("application/json");
      expect(
        req.body.equals(
          compiled.bodies.get(delivery?.event.id ?? ("" as never)) ?? Buffer.alloc(0),
        ),
      ).toBe(true);
      const verdict = adapter.verify(
        {
          method: req.method,
          path: req.path,
          headers: req.headers,
          body: req.body,
          receivedAt: asInstant(clock),
        },
        keys,
      );
      expect(verdict.valid).toBe(true);
    });
    // Redelivery: same bytes, fresh signature timestamp per attempt.
    const [a, b] = target.requests;
    expect(a?.body.equals(b?.body ?? Buffer.alloc(0))).toBe(true);
    expect(a?.headers[FAKE_SIGNATURE_HEADER]).not.toBe(b?.headers[FAKE_SIGNATURE_HEADER]);
    for (const d of result.deliveries) expect(d.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("records rejections, timeouts and status codes without stopping the run", async () => {
    let n = 0;
    const target = await serve(async (_req, res) => {
      n++;
      if (n === 1) res.writeHead(500).end("boom");
      else if (n === 2)
        await sleep(500); // never answers within the budget
      else res.writeHead(204).end();
    });
    const compiled = compile([{ duplicate: { event: "invoice.paid", times: 1 } }]);
    const result = await executePlan(compiled, adapter, {
      url: target.url,
      keys,
      env,
      timeoutMillis: 100,
    });
    expect(
      result.deliveries.map((d) => [d.statusCode ?? null, d.error ?? null, d.accepted]),
    ).toEqual([
      [500, null, false],
      [null, "no response within 100 ms", false],
      [204, null, true],
    ]);
  });

  it("times out a response whose headers arrive but whose body stalls", async () => {
    const target = await serve(async (_req, res) => {
      res.writeHead(200);
      res.flushHeaders();
      await sleep(400);
      res.end();
    });
    const result = await executePlan(compile([]), adapter, {
      url: target.url,
      keys,
      env,
      timeoutMillis: 100,
    });
    expect(
      result.deliveries.map((d) => [d.statusCode ?? null, d.error ?? null, d.accepted]),
    ).toEqual([
      [null, "no response within 100 ms", false],
      [null, "no response within 100 ms", false],
    ]);
  });

  it("uses the local 10 s default, not the provider's timeout metadata", async () => {
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(10_000);
    const target = await serve(async (_req, res) => {
      await sleep(150);
      res.writeHead(200).end();
    });
    // Profile metadata far below the response time must not cut the request short.
    for (const profileTimeout of [null, 50]) {
      const metadataOnly = createFakeProvider({ env, timeoutMillis: profileTimeout });
      const result = await executePlan(compile([]), metadataOnly, { url: target.url, keys, env });
      expect(result.deliveries.map((d) => [d.statusCode, d.accepted])).toEqual([
        [200, true],
        [200, true],
      ]);
    }
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31])(
    "rejects local timeout %s as CONFIG_INVALID before secrets or network",
    async (timeoutMillis) => {
      const target = await serve();
      const run = executePlan(compile([]), adapter, {
        url: target.url,
        keys,
        env: {},
        timeoutMillis,
      });
      await expect(run).rejects.toMatchObject({
        code: "CONFIG_INVALID",
        message: expect.stringContaining("timeoutMillis"),
      });
      expect(target.requests).toHaveLength(0);
    },
  );

  it("makes the local timeout the only request deadline, even on an injected dispatcher", async () => {
    // undici's timers are coarse (~1 s), so headers must be later than that to trip one.
    let n = 0;
    const target = await serve(async (_req, res) => {
      if (++n === 1) await sleep(1200);
      res.writeHead(200).end();
    });
    // Stands in for undici's 300 s defaults, which would otherwise cap a longer local timeout.
    class RecordingAgent extends Agent {
      readonly seen: Dispatcher.DispatchOptions[] = [];
      override dispatch(opts: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler) {
        this.seen.push(opts);
        return super.dispatch(opts, handler);
      }
    }
    const dispatcher = new RecordingAgent({ headersTimeout: 50, bodyTimeout: 50 });
    try {
      const result = await executePlan(compile([]), adapter, {
        url: target.url,
        keys,
        env,
        dispatcher,
        timeoutMillis: 5000,
      });
      // Without per-request overrides the first delivery fails with UND_ERR_HEADERS_TIMEOUT.
      expect(result.deliveries.map((d) => [d.statusCode, d.error ?? null, d.accepted])).toEqual([
        [200, null, true],
        [200, null, true],
      ]);
      expect(dispatcher.seen.map((o) => [o.headersTimeout, o.bodyTimeout])).toEqual([
        [0, 0],
        [0, 0],
      ]);
    } finally {
      await dispatcher.close();
    }
  });

  it("releases a concurrency group together behind a barrier", async () => {
    // The target holds every request until three are in flight, or 1 s passes.
    const waiting: Array<() => void> = [];
    const target = await serve(async (_req, res) => {
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
        if (waiting.length >= 3) for (const release of waiting) release();
        setTimeout(resolve, 1000);
      });
      res.writeHead(200).end();
    });
    const compiled = compile([{ concurrent: { event: "invoice.paid", deliveries: 3 } }]);
    const started = performance.now();
    const result = await executePlan(compiled, adapter, { url: target.url, keys, env });
    expect(target.maxInFlight).toBe(3);
    expect(performance.now() - started).toBeLessThan(900);
    expect(result.deliveries.slice(0, 3).map((d) => [d.concurrencyGroup, d.attempt])).toEqual([
      ["g1", 1],
      ["g1", 2],
      ["g1", 3],
    ]);
  });

  it("exposes a non-atomic check-then-insert race", async () => {
    const processed = new Set<string>();
    let grants = 0;
    const target = await serve(async (req, res) => {
      const { id } = JSON.parse(req.body.toString("utf8")) as { id: string };
      if (!processed.has(id)) {
        await sleep(20); // the gap between "check" and "insert" in a naive handler
        processed.add(id);
        grants++;
      }
      res.writeHead(200).end();
    });
    const compiled = compile([{ concurrent: { event: "invoice.paid", deliveries: 3 } }]);
    await executePlan(compiled, adapter, { url: target.url, keys, env });
    expect(grants).toBeGreaterThan(1);
  });

  it("honours delay offsets scaled by timeScale", async () => {
    const target = await serve();
    const compiled = compile([{ delay: { event: "customer.subscription.updated", byMs: 400 } }]);
    await executePlan(compiled, adapter, { url: target.url, keys, env, timeScale: 0.5 });
    const [first, second] = target.requests;
    expect((second?.receivedAt ?? 0) - (first?.receivedAt ?? 0)).toBeGreaterThanOrEqual(180);

    const fast = await startRecordingServer();
    const t0 = performance.now();
    await executePlan(compile([{ delay: { event: "invoice.paid", byMs: 60_000 } }]), adapter, {
      url: fast.url,
      keys,
      env,
      timeScale: 0,
    });
    expect(performance.now() - t0).toBeLessThan(1000);
    await fast.close();
  });

  it("calls onDelivery as each delivery completes", async () => {
    const target = await serve();
    const seen: number[] = [];
    await executePlan(compile([]), adapter, {
      url: target.url,
      keys,
      env,
      onDelivery: (d) => seen.push(d.seq),
    });
    expect(seen).toEqual([0, 1]);
  });

  it("blocks remote targets before sending anything", async () => {
    const target = await serve();
    const code = await codeOf(
      executePlan(compile([]), adapter, { url: "https://hooks.example.com/x", keys, env }),
    );
    expect(code).toBe("REMOTE_TARGET_BLOCKED");
    expect(target.requests).toHaveLength(0);
  });

  it("fails fast with SECRET_MISSING before sending anything", async () => {
    const target = await serve();
    const code = await codeOf(
      executePlan(compile([]), adapter, { url: target.url, keys, env: {} }),
    );
    expect(code).toBe("SECRET_MISSING");
    expect(target.requests).toHaveLength(0);
  });

  it("reports an unreachable target as TARGET_UNREACHABLE (exit 3)", async () => {
    const closed = await startRecordingServer();
    await closed.close();
    try {
      await executePlan(compile([]), adapter, { url: closed.url, keys, env });
      expect.unreachable();
    } catch (error) {
      expect((error as PaymentChaosError).code).toBe("TARGET_UNREACHABLE");
      expect((error as PaymentChaosError).exitCode).toBe(3);
    }
  });

  it("never leaks the secret through signing errors", async () => {
    const target = await serve();
    const leaky = {
      ...adapter,
      sign: () => {
        throw new Error(`bad key ${env.FAKE_SECRET}`);
      },
    };
    try {
      await executePlan(compile([]), leaky, { url: target.url, keys, env });
      expect.unreachable();
    } catch (error) {
      expect((error as PaymentChaosError).code).toBe("SIGNING_FAILED");
      expect((error as Error).message).not.toContain(env.FAKE_SECRET);
      expect((error as Error).message).toContain("[REDACTED]");
    }
  });

  it("stops when the caller aborts", async () => {
    const target = await serve();
    const controller = new AbortController();
    const compiled = compile([{ delay: { event: "customer.subscription.updated", byMs: 10_000 } }]);
    const run = executePlan(compiled, adapter, {
      url: target.url,
      keys,
      env,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error("cancelled")), 100);
    await expect(run).rejects.toThrow("cancelled");
    expect(target.requests).toHaveLength(1);
  });
});
