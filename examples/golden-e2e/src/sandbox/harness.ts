import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { messages as m } from "./messages.ts";
import { runCliProcess, SandboxCleanupError } from "./process.ts";
import { startSandboxServer } from "./server.ts";

const bin = fileURLToPath(new URL("../../../../packages/cli/dist/bin.js", import.meta.url));
export type CaseContext = Parameters<Parameters<Harness["test"]>[1]>[0];
export type Harness = Awaited<ReturnType<typeof createHarness>>;

export async function createHarness(root: string, timeoutMs = 20_000, executable = bin) {
  if (!existsSync(executable)) throw new Error(m.missingBuild);
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "run-"));
  const secret = `whsec_${randomBytes(32).toString("base64")}`;
  const secrets = new Set([secret, secret.slice(6)]);
  const redact = (text: string) =>
    [...secrets].reduce((value, key) => value.replaceAll(key, "[REDACTED]"), text);
  const server = await startSandboxServer(secret);
  const results: { name: string; pass: boolean; error?: string }[] = [];
  return {
    directory,
    server,
    results,
    async test(
      name: string,
      body: (ctx: {
        cwd: string;
        write: (path: string, value: unknown) => Promise<void>;
        cli: (
          args: string[],
          expected: number,
          contains?: string,
          env?: NodeJS.ProcessEnv,
        ) => Promise<string>;
        configure: (
          provider: string,
          types: readonly string[],
          overrides?: Record<string, unknown>,
          money?: { currency: string; amount: number },
        ) => Promise<void>;
      }) => Promise<void>,
    ) {
      server.reset();
      const cwd = join(directory, `${String(results.length + 1).padStart(2, "0")} café app`);
      await mkdir(cwd);
      let commands = 0;
      const write = async (path: string, value: unknown) => {
        const destination = join(cwd, path);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(
          destination,
          typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`,
        );
      };
      const cli = async (
        args: string[],
        expected: number,
        contains?: string,
        env?: NodeJS.ProcessEnv,
      ) => {
        const override = env?.PC_SANDBOX_SECRET;
        if (override) {
          secrets.add(override);
          if (override.startsWith("whsec_") && override.length > 6) secrets.add(override.slice(6));
        }
        const result = await runCliProcess(
          executable,
          args,
          cwd,
          { ...process.env, PC_SANDBOX_SECRET: secret, NO_COLOR: "1", ...env },
          timeoutMs,
        );
        const output = result.stdout + result.stderr;
        await write(
          `command-${++commands}.log`,
          redact(`node paymentchaos ${args.join(" ")}\nexit: ${result.code}\n${output}`),
        );
        assert(![...secrets].some((key) => output.includes(key)), m.secretLeak);
        assert(!result.failed, m.timeout);
        assert.equal(result.code, expected, m.exit(expected, result.code));
        if (contains) assert(output.includes(contains), m.output(contains));
        return output;
      };
      try {
        await body({
          cwd,
          write,
          cli,
          configure: async (provider, types, overrides = {}, money) => {
            await write("verify.mjs", m.verify(server.baseUrl, types, money));
            await write("reset.mjs", m.reset(server.baseUrl));
            await write("fail.mjs", m.fail);
            await write("paymentchaos.config.yaml", {
              version: 1,
              providers: {
                [provider]: {
                  target: { url: `${server.baseUrl}/${provider}`, secret: "${PC_SANDBOX_SECRET}" },
                },
              },
              assert: { command: "node verify.mjs" },
              ...overrides,
            });
          },
        });
        results.push({ name, pass: true });
      } catch (error) {
        if (error instanceof SandboxCleanupError) throw error;
        results.push({
          name,
          pass: false,
          error: redact(error instanceof Error ? error.message : String(error)),
        });
      }
      await write("observations.json", { case: results.at(-1), ...server.state });
    },
    async finish() {
      await server.close();
      await writeFile(
        join(directory, "results.json"),
        JSON.stringify({ node: process.version, platform: process.platform, results }, null, 2),
      );
      await writeFile(join(directory, "RESULTS.md"), m.report(results));
      return { directory, results };
    },
  };
}
