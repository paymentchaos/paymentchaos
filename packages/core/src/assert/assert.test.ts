import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, describe, expect, it } from "vitest";
import { commandAssertionResults, parseCommandOutput, runCommandAssertion } from "./command.ts";
import { buildCommandEnv, type RunMetadata } from "./env.ts";

const dir = mkdtempSync(join(tmpdir(), "paymentchaos-assert-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A command that runs `source` with this Node, quoted for both sh and cmd.exe. */
const script = (name: string, source: string, ...args: string[]) => {
  const file = join(dir, `${name}.mjs`);
  writeFileSync(file, source);
  return [process.execPath, file, ...args].map((part) => `"${part}"`).join(" ");
};

const metadata: RunMetadata = {
  runId: "run_test",
  seed: 1337,
  planHash: "abc123",
  repeatIndex: 2,
  ids: { customer: "cus_X", subscription: "sub_Y", event_2: "evt_Z" },
};

describe("buildCommandEnv", () => {
  const parentEnv = {
    PATH: "/usr/bin",
    HOME: "/home/dev",
    STRIPE_WEBHOOK_SECRET: "whsec_parent",
    AWS_SECRET_ACCESS_KEY: "nope",
    DATABASE_URL: "postgres://x",
  };

  it("passes only the allowlist plus PAYMENTCHAOS_* variables", () => {
    expect(buildCommandEnv(metadata, { parentEnv, platform: "linux" })).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/dev",
      PAYMENTCHAOS: "1",
      PAYMENTCHAOS_RUN_ID: "run_test",
      PAYMENTCHAOS_SEED: "1337",
      PAYMENTCHAOS_PLAN_HASH: "abc123",
      PAYMENTCHAOS_REPEAT_INDEX: "2",
      PAYMENTCHAOS_IDS_JSON: '{"customer":"cus_X","subscription":"sub_Y","event_2":"evt_Z"}',
      PAYMENTCHAOS_ID_CUSTOMER: "cus_X",
      PAYMENTCHAOS_ID_SUBSCRIPTION: "sub_Y",
      PAYMENTCHAOS_ID_EVENT_2: "evt_Z",
    });
  });

  it("passes explicitly opted-in variables", () => {
    const env = buildCommandEnv(metadata, {
      parentEnv,
      passEnv: ["DATABASE_URL"],
      platform: "linux",
    });
    expect(env.DATABASE_URL).toBe("postgres://x");
    expect(env.STRIPE_WEBHOOK_SECRET).toBeUndefined();
  });

  it("matches names case-insensitively on Windows only", () => {
    const winParent = { Path: "C:\\Windows", SystemRoot: "C:\\Windows", ComSpec: "cmd.exe" };
    const win = buildCommandEnv(metadata, { parentEnv: winParent, platform: "win32" });
    expect(win).toMatchObject(winParent);
    const posix = buildCommandEnv(metadata, { parentEnv: { Path: "/x" }, platform: "linux" });
    expect(posix.Path).toBeUndefined();
  });
});

describe("parseCommandOutput", () => {
  const doc = { checks: [{ name: "entitlements", pass: false, expected: 1, observed: 2 }] };

  it("accepts a whole-stdout document, compact or pretty", () => {
    expect(parseCommandOutput(JSON.stringify(doc)).result).toEqual(doc);
    expect(parseCommandOutput(JSON.stringify(doc, null, 2)).result).toEqual(doc);
  });

  it("finds the trailing document after banner lines", () => {
    const stdout = `\n> app@1.0.0 verify\n> node verify.js\n\n${JSON.stringify(doc, null, 2)}\n`;
    expect(parseCommandOutput(stdout).result).toEqual(doc);
  });

  it("treats empty or plain-text output as no document", () => {
    expect(parseCommandOutput("")).toEqual({});
    expect(parseCommandOutput("all good\n")).toEqual({});
  });

  it("reports JSON that breaks the protocol", () => {
    expect(parseCommandOutput('{"checks":[{"pass":"yes"}]}').protocolError).toMatch(
      /result document/,
    );
  });
});

describe("runCommandAssertion", () => {
  it("passes on exit 0 and fails on non-zero, keeping stderr", async () => {
    const ok = await runCommandAssertion(script("ok", "process.exit(0)"), { metadata });
    expect(ok).toMatchObject({ pass: true, exitCode: 0, attempts: 1 });
    const bad = await runCommandAssertion(
      script("bad", "console.error('two entitlements'); process.exit(3)"),
      { metadata },
    );
    expect(bad).toMatchObject({ pass: false, exitCode: 3 });
    expect(commandAssertionResults(bad)[0]?.message).toContain("two entitlements");
  });

  it("parses the JSON protocol, but the exit code decides the verdict", async () => {
    const doc = {
      checks: [
        { name: "entitlements", pass: false, expected: 1, observed: 2, message: "duplicate grant" },
      ],
    };
    const cmd = script(
      "json",
      `console.log("banner"); console.log(${JSON.stringify(JSON.stringify(doc))}); process.exit(1)`,
    );
    const outcome = await runCommandAssertion(cmd, { metadata });
    expect(outcome.checks).toEqual(doc.checks);
    expect(commandAssertionResults(outcome)).toEqual([
      {
        name: "assert.command exits 0",
        pass: false,
        message: expect.stringContaining("exited with 1"),
      },
      doc.checks[0],
    ]);
  });

  it("gives the command the documented environment and nothing secret", async () => {
    process.env.PAYMENTCHAOS_TEST_PARENT_SECRET = "whsec_should_not_leak";
    try {
      const cmd = script(
        "env",
        "console.log(JSON.stringify({ checks: [{ name: 'env', pass: true, observed: process.env }] }))",
      );
      const outcome = await runCommandAssertion(cmd, { metadata });
      const seen = outcome.checks[0]?.observed as Record<string, string>;
      expect(seen.PAYMENTCHAOS_ID_CUSTOMER).toBe("cus_X");
      expect(JSON.parse(seen.PAYMENTCHAOS_IDS_JSON ?? "{}")).toEqual(metadata.ids);
      expect(seen.PAYMENTCHAOS_TEST_PARENT_SECRET).toBeUndefined();
    } finally {
      delete process.env.PAYMENTCHAOS_TEST_PARENT_SECRET;
    }
  });

  it("settles: re-runs until the app catches up", async () => {
    const counter = join(dir, "counter");
    writeFileSync(counter, "0");
    const cmd = script(
      "settle",
      `import { readFileSync, writeFileSync } from "node:fs";
       const n = Number(readFileSync(process.argv[2], "utf8")) + 1;
       writeFileSync(process.argv[2], String(n));
       process.exit(n >= 3 ? 0 : 1);`,
      counter,
    );
    const outcome = await runCommandAssertion(cmd, {
      metadata,
      settle: { timeoutMs: 10_000, intervalMs: 10 },
    });
    expect(outcome).toMatchObject({ pass: true, attempts: 3 });
  });

  it("settles: gives up after timeoutMs with the last failure", async () => {
    const started = performance.now();
    const outcome = await runCommandAssertion(script("never", "process.exit(1)"), {
      metadata,
      settle: { timeoutMs: 300, intervalMs: 100 },
    });
    expect(outcome.pass).toBe(false);
    expect(outcome.attempts).toBeGreaterThanOrEqual(2);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it("kills a command that exceeds its timeout", async () => {
    const outcome = await runCommandAssertion(script("hang", "setTimeout(() => {}, 60_000)"), {
      metadata,
      timeoutMs: 300,
    });
    expect(outcome).toMatchObject({ pass: false, timedOut: true });
    expect(commandAssertionResults(outcome)[0]?.message).toMatch(/timed out/);
  });

  it("fails a command Node.js refuses to start without quoting it", async () => {
    const secret = "whsec_synthetic_nul";
    const other = "synthetic_app_token_7f3a";
    const outcome = await runCommandAssertion(`echo ${secret} ${other}\u0000`, {
      metadata,
      redact: [secret],
    });
    expect(outcome).toMatchObject({ pass: false, exitCode: null, timedOut: false });
    expect(outcome.stderrTail).toContain("ERR_INVALID_ARG_VALUE");
    // `outcome.command` is the caller's own input; reports are built from the results and tails.
    const { command: _input, ...reported } = outcome;
    for (const text of [
      JSON.stringify(reported),
      JSON.stringify(commandAssertionResults(outcome)),
    ]) {
      expect(text).not.toContain(secret);
      expect(text).not.toContain(other);
    }
  });

  it("kills a command started after the run was already aborted", async () => {
    const started = performance.now();
    const signal = AbortSignal.abort(new Error("interrupted"));
    await expect(
      runCommandAssertion(script("late", "setTimeout(() => {}, 60_000)"), { metadata, signal }),
    ).rejects.toThrow("interrupted");
    expect(performance.now() - started).toBeLessThan(5000);
  });

  describe("a command that leaves a process in the background", () => {
    // The background child inherits stdout, stays quiet until the command has finished,
    // then floods the pipe: it must neither stall the command nor die of EPIPE.
    const background = (name: string) =>
      script(
        name,
        `import { spawn } from "node:child_process";
         const child = spawn(process.execPath, ["-e", \`
           setTimeout(() => setInterval(() => process.stdout.write("x".repeat(65536)), 10), 1000);
           setTimeout(() => process.exit(0), 60000);\`],
           { stdio: ["ignore", "inherit", "inherit"], detached: process.platform === "win32" });
         child.unref();
         console.log(JSON.stringify({ checks: [{ name: "started", pass: true, observed: child.pid }] }));`,
      );
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const pidOf = (outcome: { checks: readonly { observed?: unknown }[] }) =>
      outcome.checks[0]?.observed as number;

    it("completes when the shell exits and leaves the process running", async () => {
      const outcome = await runCommandAssertion(background("bg-keep"), {
        metadata,
        timeoutMs: 20_000,
      });
      const pid = pidOf(outcome);
      try {
        expect(outcome).toMatchObject({ pass: true, exitCode: 0, timedOut: false });
        expect(outcome.durationMs).toBeLessThan(5000);
        await sleep(1500);
        expect(alive(pid)).toBe(true);
      } finally {
        if (alive(pid)) process.kill(pid);
      }
    });

    it.skipIf(process.platform === "win32")(
      "kills the leftover process group when the run is aborted",
      async () => {
        const controller = new AbortController();
        const outcome = await runCommandAssertion(background("bg-abort"), {
          metadata,
          signal: controller.signal,
        });
        const pid = pidOf(outcome);
        expect(alive(pid)).toBe(true);
        controller.abort();
        await sleep(200);
        expect(alive(pid)).toBe(false);
      },
    );
  });

  it.each(["slash", "unicode"])(
    "redacts %s-escaped JSON secrets in checks and diagnostic tails",
    async (encoding) => {
      const secret = encoding === "slash" ? "whsec_synthetic/slash" : 'synthetic_"\\\nキー🙂';
      const marker = "[REDACTED]";
      const doc = {
        checks: [
          {
            name: secret,
            pass: false,
            message: `key=${secret}`,
            expected: { [secret]: [secret, 0, false, null] },
            observed: secret,
          },
        ],
      };
      const encoded = JSON.stringify(doc).replace(/"(?:[^"\\]|\\.)*"/g, (token) => {
        if (encoding === "slash") return token.replaceAll("/", "\\/");
        const value = JSON.parse(token) as string;
        return `"${value
          .split("")
          .map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)
          .join("")}"`;
      });
      const outcome = await runCommandAssertion(
        script(
          `escaped-${encoding}`,
          `console.log("banner"); console.log(${JSON.stringify(encoded)}); console.error(${JSON.stringify(encoded)}); process.exitCode=1;`,
        ),
        { metadata, redact: [secret] },
      );
      expect(outcome.protocolError).toBeUndefined();
      expect(outcome.pass).toBe(false);
      expect(outcome.checks).toEqual([
        {
          name: marker,
          pass: false,
          message: `key=${marker}`,
          expected: { [marker]: [marker, 0, false, null] },
          observed: marker,
        },
      ]);
      expect(parseCommandOutput(outcome.stdoutTail).result?.checks).toEqual(outcome.checks);
      expect(parseCommandOutput(outcome.stderrTail).result?.checks).toEqual(outcome.checks);
      expect(JSON.stringify(commandAssertionResults(outcome))).not.toContain(
        JSON.stringify(secret).slice(1, -1),
      );
    },
  );

  it.each([false, true])(
    "bounds processing of 1 MiB escaped logs on both streams (redact=%s)",
    (redact) => {
      const secret = "whsec_synthetic/slash";
      const document = JSON.stringify({
        checks: [{ name: "after logs", pass: false, observed: secret }],
      }).replaceAll("/", "\\/");
      const command = script(
        `large-logs-${redact}`,
        `
      const noise = String.fromCharCode(34, 92).repeat(512 * 1024);
      for (const stream of [process.stdout, process.stderr]) {
        stream.write(noise);
        stream.write(${JSON.stringify(`\r\n${document}\n`)});
      }
      process.exitCode = 1;
    `,
      );
      const probe = join(dir, `bounded-redaction-${redact}.mjs`);
      writeFileSync(
        probe,
        `
      import { runCommandAssertion } from ${JSON.stringify(new URL("./command.ts", import.meta.url).href)};
      const result = await runCommandAssertion(${JSON.stringify(command)}, {
        metadata: ${JSON.stringify(metadata)}, redact: ${JSON.stringify(redact ? [secret] : [])}, timeoutMs: 3000,
      });
      console.log(JSON.stringify({pass: result.pass, timedOut: result.timedOut, checks: result.checks}));
    `,
      );
      // A separate process bounds even synchronous processing that would defeat a Vitest timeout.
      const result = spawnSync(process.execPath, ["--experimental-strip-types", probe], {
        encoding: "utf8",
        timeout: 5000,
      });
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        pass: false,
        timedOut: false,
        checks: [{ name: "after logs", pass: false, observed: redact ? "[REDACTED]" : secret }],
      });
    },
    10_000,
  );

  it("redacts secrets from captured output", async () => {
    const outcome = await runCommandAssertion(
      script("leak", "console.error('key=whsec_leaky'); process.exit(1)"),
      {
        metadata,
        redact: ["whsec_leaky"],
      },
    );
    expect(outcome.stderrTail).not.toContain("whsec_leaky");
  });
});
