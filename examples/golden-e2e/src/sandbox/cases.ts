import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Harness } from "./harness.ts";
import { messages as m } from "./messages.ts";
import { startSandboxServer } from "./server.ts";

const flows = [
  {
    name: "stripe-subscription-renewal",
    provider: "stripe",
    types: ["invoice.paid", "customer.subscription.updated"],
    deliveries: 6,
  },
  {
    name: "stripe-cancellation-out-of-order",
    provider: "stripe",
    types: ["invoice.paid", "customer.subscription.updated", "customer.subscription.deleted"],
    deliveries: 3,
  },
  {
    name: "stripe-one-time-payment",
    provider: "stripe",
    types: ["payment_intent.succeeded", "checkout.session.completed"],
    deliveries: 4,
  },
  {
    name: "razorpay-subscription-charged",
    provider: "razorpay",
    types: ["subscription.charged"],
    deliveries: 5,
  },
  {
    name: "razorpay-payment-captured",
    provider: "razorpay",
    types: ["order.paid", "payment.captured"],
    deliveries: 2,
  },
  {
    name: "generic-hmac-duplicate",
    provider: "generic-hmac",
    types: ["custom.updated", "custom.created"],
    deliveries: 5,
  },
] as const;
const renewal = flows[0];
const run = (name: string = renewal.name, extra: string[] = []) => [
  "run",
  name,
  "--seed",
  "1337",
  ...extra,
];
const scenario = { version: 1, name: "custom", provider: "stripe", flow: "one-time-payment" };

export async function runCases(h: Harness) {
  const { server } = h;
  for (const f of [flows[0], flows[3], flows[5]]) {
    await h.test(`init ${f.provider}: no traffic, no overwrite, starter fails`, async (t) => {
      await t.cli(
        [
          "init",
          "--provider",
          f.provider,
          "--target",
          `${server.baseUrl}/${f.provider}`,
          "--secret-env",
          "PC_SANDBOX_SECRET",
        ],
        0,
      );
      assert.equal(server.state.deliveries, 0);
      const config = await readFile(join(t.cwd, "paymentchaos.config.yaml"), "utf8");
      assert(config.includes("${PC_SANDBOX_SECRET}"));
      await t.cli(["init"], 2, "never overwritten");
      assert.equal(await readFile(join(t.cwd, "paymentchaos.config.yaml"), "utf8"), config);
      await t.cli(run(f.name), 1, "Implement paymentchaos/verify.mjs");
      assert.equal(server.state.deliveries, f.deliveries);
    });
  }
  await h.test(
    "init detects Razorpay and Express; ambiguous detection needs a choice",
    async (t) => {
      await t.write("package.json", { dependencies: { razorpay: "*", stripe: "*", express: "*" } });
      await t.cli(["init"], 2, "Both Stripe and Razorpay");
      await t.write("package.json", {
        dependencies: { razorpay: "*", express: "*" },
        scripts: { postinstall: "exit 9" },
      });
      await t.cli(["init"], 0, "Detected express");
    },
  );
  for (const args of [
    ["--provider", "typo"],
    ["--typo"],
    ["--provider", "stripe", "--provider", "razorpay"],
    ["--secret-env", "whsec_synthetic_private_key"],
    ["--secret-env", "${SECRET}"],
    ["--target", "https://example.invalid/hook"],
    ["--target", "http://user:password@localhost/hook"],
  ])
    await h.test(`init refuses ${args[0]} ${args[1] ?? ""}`, async (t) => {
      const output = await t.cli(["init", ...args], 2);
      assert(!output.includes("whsec_synthetic_private_key"));
      assert.deepEqual(await readdir(t.cwd), ["command-1.log"]);
    });
  await h.test("init refuses a broken package manifest", async (t) => {
    await t.write("package.json", "{ broken");
    await t.cli(["init"], 2, "package.json");
  });
  await h.test("help and provider flow discovery", async (t) => {
    await t.cli(["--help"], 0, "init");
    await t.cli(["init", "--help"], 0, "secret-env");
    const output = await t.cli(["flows"], 0, "Lifecycle packs");
    for (const f of flows) assert(output.includes(f.provider));
  });

  for (const f of flows) {
    await h.test(`${f.name}: SDK signatures, raw bytes, state and ordering`, async (t) => {
      await t.configure(f.provider, f.types);
      await t.cli(run(f.name), 0, "PAYMENTCHAOS PASSED");
      assert.equal(server.state.deliveries, f.deliveries);
      assert.deepEqual([...new Set(server.state.order)], f.types);
      assert.equal(new Set(server.state.ids).size, f.types.length);
    });
    if (f.deliveries > f.types.length)
      await h.test(`${f.name}: repeated side effects must fail`, async (t) => {
        server.mode.naive = true;
        await t.configure(f.provider, f.types);
        await t.cli(run(f.name), 1, "one side effect per event type");
        assert(Object.values(server.state.counts).some((n) => n > 1));
      });
  }
  for (const provider of ["stripe", "razorpay"])
    for (const [currency, exponent] of [
      ["JPY", 0],
      ["INR", 2],
      ["BHD", 3],
    ] as const) {
      await h.test(
        `${provider}: ${currency} integer amounts with duplicates and delay`,
        async (t) => {
          const f = provider === "stripe" ? flows[2] : flows[4];
          const type = provider === "stripe" ? "payment_intent.succeeded" : "payment.captured";
          await t.configure(
            provider,
            f.types,
            {},
            { currency, amount: (provider === "stripe" ? 10_000 : 100) * 10 ** exponent },
          );
          await t.write("case.yaml", {
            ...scenario,
            provider,
            flow: provider === "stripe" ? "one-time-payment" : "payment-captured",
            params: { currency },
            chaos: [{ duplicate: { event: type, times: 2 } }, { delay: { event: type, byMs: 10 } }],
          });
          await t.cli(run("case.yaml"), 0, "PAYMENTCHAOS PASSED");
        },
      );
    }
  await h.test("plan repeats exactly without a secret, hooks or network", async (t) => {
    await t.configure("stripe", renewal.types, { hooks: { beforeEach: "node reset.mjs" } });
    const args = ["plan", renewal.name, "--seed", "-1"];
    const a = await t.cli(args, 0, "Plan ", { PC_SANDBOX_SECRET: "" });
    assert.equal(await t.cli(args, 0, "Plan ", { PC_SANDBOX_SECRET: "" }), a);
    assert.equal(server.state.deliveries + server.state.resets, 0);
  });
  await h.test("repeat resets state; stable IDs and selected repeat reproduce IDs", async (t) => {
    await t.configure("stripe", renewal.types, { hooks: { beforeEach: "node reset.mjs" } });
    await t.cli(
      run(renewal.name, ["--repeat", "3", "--stable-ids"]),
      0,
      "All 3 repetition(s) passed",
    );
    assert.equal(server.state.resets, 3);
    assert.equal(server.state.deliveries, 18);
    const ids = [...server.state.ids].sort();
    await t.cli(
      run(renewal.name, ["--repeat", "3", "--repeat-index", "2", "--stable-ids"]),
      0,
      "Ran only repetition 2 of 3",
    );
    assert.equal(server.state.resets, 4);
    assert.equal(server.state.deliveries, 24);
    assert.deepEqual([...server.state.ids].sort(), ids);
  });
  await h.test("scenario name, file, glob and report path with spaces", async (t) => {
    await t.configure("stripe", flows[2].types, { hooks: { beforeEach: "node reset.mjs" } });
    await t.write("paymentchaos/scenarios/custom.yaml", scenario);
    for (const ref of [
      "custom",
      "paymentchaos/scenarios/custom.yaml",
      "paymentchaos/scenarios/*.yaml",
    ]) {
      await t.cli(run(ref, ["--out", "saved report.txt"]), 0);
      assert(
        (await readFile(join(t.cwd, "saved report.txt"), "utf8")).includes("PAYMENTCHAOS PASSED"),
      );
    }
    assert.equal(server.state.resets, 3);
  });
  await h.test("settling retries a deliberately stale first state read", async (t) => {
    server.mode.staleRead = true;
    await t.configure("stripe", renewal.types, {
      assert: { command: "node verify.mjs", settle: { timeoutMs: 5000, intervalMs: 10 } },
    });
    await t.cli(run(), 0);
    assert.equal(server.state.reads, 2);
  });
  await h.test("false JSON check fails even when its command exits zero", async (t) => {
    await t.configure("stripe", renewal.types);
    await t.write("verify.mjs", m.falseJson);
    await t.cli(run(), 1, "deliberate false JSON check");
  });
  for (const phase of ["beforeEach", "afterEach"])
    await h.test(`failed ${phase} hook returns a configuration error`, async (t) => {
      await t.configure("stripe", renewal.types, { hooks: { [phase]: "node fail.mjs" } });
      await t.cli(run(), 2, `hooks.${phase}`);
      assert.equal(server.state.deliveries, phase === "beforeEach" ? 0 : 6);
    });
  for (const combined of [false, true])
    await h.test(
      `unsupported HTTP assertion (${combined ? "combined" : "alone"}) has no side effects`,
      async (t) => {
        await t.configure("stripe", renewal.types, {
          hooks: { beforeEach: "node reset.mjs" },
          assert: {
            http: { url: `${server.baseUrl}/state`, expect: {} },
            ...(combined ? { command: "node verify.mjs" } : {}),
          },
        });
        await t.cli(run(), 2, "assert.http is not supported");
        assert.equal(server.state.deliveries + server.state.resets + server.state.reads, 0);
      },
    );
  for (const status of [400, 429, 500, 302])
    await h.test(`HTTP ${status} fails; redirects are not followed`, async (t) => {
      server.mode.status = status;
      await t.configure("stripe", renewal.types);
      await t.cli(run(), 1, `HTTP ${status}`);
      assert.equal(server.state.redirects, 0);
    });
  await h.test("slow handler fails within the configured request timeout", async (t) => {
    server.mode.hang = true;
    await t.configure("stripe", renewal.types);
    await t.cli(run(renewal.name, ["--timeout-ms", "100"]), 1, "no response within 100 ms");
  });
  await h.test("unreachable endpoint exits 3", async (t) => {
    const unused = await startSandboxServer("unused-local-test-key");
    await unused.close();
    await t.write("case.yaml", {
      ...scenario,
      target: { url: `${unused.baseUrl}/stripe`, secret: "${PC_SANDBOX_SECRET}" },
    });
    await t.cli(run("case.yaml"), 3, "Could not connect");
  });
  for (const f of [flows[0], flows[3], flows[5]])
    await h.test(`${f.provider}: wrong signing key is rejected`, async (t) => {
      await t.configure(f.provider, f.types);
      await t.cli(run(f.name), 1, "HTTP 400", {
        PC_SANDBOX_SECRET: `whsec_${Buffer.alloc(32, 7).toString("base64")}`,
      });
      assert.equal(server.state.rejected, f.deliveries);
    });
  for (const args of [
    ["run"],
    ["unknown-command"],
    run("stripe-subscription-renewa"),
    ["run", renewal.name, "--seed", "1.5"],
    run(renewal.name, ["--repeat", "0"]),
    run(renewal.name, ["--repeat-index", "2"]),
    run(renewal.name, ["--timeout-ms", "2147483648"]),
    run(renewal.name, ["--reporter", "not-a-reporter"]),
  ])
    await h.test(`usage rejects ${args.join(" ")}`, async (t) => {
      await t.configure("stripe", renewal.types);
      await t.cli(args, 2);
      assert.equal(server.state.deliveries, 0);
    });
  await h.test("missing secret fails before hooks or traffic", async (t) => {
    await t.configure("stripe", renewal.types, { hooks: { beforeEach: "node reset.mjs" } });
    await t.cli(run(), 2, "PC_SANDBOX_SECRET", { PC_SANDBOX_SECRET: "" });
    assert.equal(server.state.deliveries + server.state.resets, 0);
  });
  for (const config of [
    "version: [",
    { version: 1, typo: true },
    {
      version: 1,
      providers: {
        stripe: { target: { url: `${server.baseUrl}/stripe`, secret: "whsec_not_a_real_key" } },
      },
    },
  ])
    await h.test(
      "invalid YAML/schema/literal secret is rejected with a file location",
      async (t) => {
        await t.write("paymentchaos.config.yaml", config);
        const output = await t.cli(run(), 2, "paymentchaos.config.yaml:");
        assert(!output.includes("whsec_not_a_real_key"));
        assert.equal(server.state.deliveries, 0);
      },
    );
  for (const allow of [
    undefined,
    "*.example.invalid",
    "https://example.invalid",
    "different.example.invalid",
  ])
    await h.test(
      `remote target guard (${allow ?? "no authorization"}) runs before hooks`,
      async (t) => {
        await t.configure("stripe", renewal.types, {
          hooks: { beforeEach: "node reset.mjs" },
          providers: {
            stripe: {
              target: { url: "https://example.invalid/hook", secret: "${PC_SANDBOX_SECRET}" },
            },
          },
        });
        await t.cli(
          run(renewal.name, allow === undefined ? [] : ["--allow-remote-target", allow]),
          2,
          "--allow-remote-target",
        );
        assert.equal(server.state.resets, 0);
      },
    );
}
