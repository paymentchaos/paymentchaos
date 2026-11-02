import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { ciDemoReportNames, parseCiDemoArgv, runCiDemo } from "../src/ci-demo.js";
import { CiDemoError } from "../src/ci-demo-error.js";
import { messages } from "../src/ci-demo-messages.js";
import { runCliReport } from "../src/cli-scenario-runner.js";

const examplesRoot = join(import.meta.dirname, "..", "..");

function requireBuiltCli(): void {
  if (!existsSync(join(examplesRoot, "..", "packages", "cli", "dist", "bin.js"))) {
    throw new Error(messages.missingBuild);
  }
}

function usageError(argv: string[]): CiDemoError {
  try {
    parseCiDemoArgv(argv);
  } catch (error) {
    if (error instanceof CiDemoError) return error;
    throw error;
  }
  throw new Error(`parseCiDemoArgv accepted ${JSON.stringify(argv)}`);
}

describe("ci demo argument parsing", () => {
  const outDir = join(tmpdir(), "paymentchaos reports 日本語");

  it("accepts exactly --out <absolute dir>, optionally after --", () => {
    expect(parseCiDemoArgv(["--out", outDir])).toEqual({ outDir });
    expect(parseCiDemoArgv(["--", "--out", outDir])).toEqual({ outDir });
  });

  it("rejects missing, relative, unknown, duplicate and --out= arguments", () => {
    expect(usageError([]).message).toBe(messages.missingOut);
    expect(usageError(["--out"]).message).toBe(messages.missingOut);
    expect(usageError(["--out", "relative/reports"]).message).toBe(
      messages.outNotAbsolute("relative/reports"),
    );
    expect(usageError(["--verbose", "--out", outDir]).message).toBe(
      messages.unexpectedArgument("--verbose"),
    );
    expect(usageError(["--out", outDir, "extra"]).message).toBe(
      messages.unexpectedArgument("extra"),
    );
    expect(usageError(["--out", outDir, "--out", outDir]).message).toBe(
      messages.unexpectedArgument("--out"),
    );
    expect(usageError([`--out=${outDir}`]).message).toBe(
      messages.unexpectedArgument(`--out=${outDir}`),
    );
    expect(usageError(["--", "--", "--out", outDir]).code).toBe("USAGE");
  });
});

describe("ci demo output directory", () => {
  it("refuses a non-empty directory without touching its files", async () => {
    requireBuiltCli();
    const outDir = await mkdtemp(join(tmpdir(), "paymentchaos-ci-demo-stale-"));
    const stale = join(outDir, ciDemoReportNames.naiveJson);
    try {
      await writeFile(stale, "stale report from an earlier run", "utf8");
      await expect(runCiDemo(outDir)).rejects.toMatchObject({
        code: "OUTPUT_INVALID",
        message: messages.outputNotEmpty(outDir),
      });
      await expect(readFile(stale, "utf8")).resolves.toBe("stale report from an earlier run");
      await expect(runCiDemo(stale)).rejects.toMatchObject({
        code: "OUTPUT_INVALID",
        message: messages.outputNotDirectory(stale),
      });
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

describe("ci demo CLI time limit", () => {
  it("reports a timeout, not a start failure, and stops the CLI", async () => {
    requireBuiltCli();
    // Accepts webhook requests and never answers, so the CLI waits on its first delivery.
    const sockets = new Set<Socket>();
    const server: Server = createServer(() => {});
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no server port");
    const outDir = await mkdtemp(join(tmpdir(), "paymentchaos-ci-demo-timeout-"));
    const label = "stripe-express-naive (json)";
    try {
      const run = runCliReport(
        { exampleDir: join(examplesRoot, "stripe-express-naive") },
        {
          targetWebhookUrl: `http://127.0.0.1:${address.port}/webhooks/stripe`,
          webhookSecret: "whsec_test_timeout_example",
          seed: 1337,
        },
        { label, reporter: "json", outPath: join(outDir, "report.json"), timeoutMs: 1500 },
      );
      const error = await run.then(
        () => undefined,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(CiDemoError);
      expect((error as CiDemoError).code).toBe("CLI_TIMEOUT");
      expect((error as CiDemoError).message).toContain(messages.cliTimeout(label, 1500));
      expect((error as CiDemoError).message).not.toContain("whsec_test_timeout_example");
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
      await rm(outDir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("ci demo reports", () => {
  it("writes four machine reports with expected exits and verdicts despite stderr warnings", async () => {
    requireBuiltCli();
    const outDir = await mkdtemp(join(tmpdir(), "paymentchaos-ci-demo-"));
    const preloadDir = await mkdtemp(join(tmpdir(), "paymentchaos-ci-demo-warn-"));
    const previousNodeOptions = process.env.NODE_OPTIONS;
    try {
      // Every CLI child prints a Node warning on stderr; reports must still equal stdout.
      const preload = join(preloadDir, "warn.mjs");
      await writeFile(preload, 'process.emitWarning("benign golden-e2e warning");\n', "utf8");
      process.env.NODE_OPTIONS =
        `${previousNodeOptions ?? ""} --import "${pathToFileURL(preload).href}"`.trim();
      await runCiDemo(outDir);
      for (const name of Object.values(ciDemoReportNames)) {
        const path = join(outDir, name);
        expect(existsSync(path), name).toBe(true);
        const text = await readFile(path, "utf8");
        expect(text.length).toBeGreaterThan(32);
        expect(text).not.toContain("whsec_test_naive_example");
        expect(text).not.toContain("whsec_test_correct_example");
        expect(text).not.toContain("benign golden-e2e warning");
      }
      const naiveJson = JSON.parse(
        await readFile(join(outDir, ciDemoReportNames.naiveJson), "utf8"),
      );
      expect(naiveJson.status).toBe("failed");
      const correctJson = JSON.parse(
        await readFile(join(outDir, ciDemoReportNames.correctJson), "utf8"),
      );
      expect(correctJson.status).toBe("passed");
      const naiveJUnit = await readFile(join(outDir, ciDemoReportNames.naiveJUnit), "utf8");
      expect(naiveJUnit).toMatch(/failures="[1-9]/);
      const correctJUnit = await readFile(join(outDir, ciDemoReportNames.correctJUnit), "utf8");
      expect(correctJUnit).toContain('failures="0" errors="0"');
    } finally {
      if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previousNodeOptions;
      await rm(outDir, { recursive: true, force: true });
      await rm(preloadDir, { recursive: true, force: true });
    }
  }, 180_000);
});
