import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ciDemoReportNames, parseCiDemoArgv, runCiDemo } from "../src/ci-demo.js";
import { messages } from "../src/ci-demo-messages.js";

describe("ci demo argument parsing", () => {
  it("requires an absolute --out directory", () => {
    expect(() => parseCiDemoArgv([])).toThrow(messages.missingOut);
    expect(() => parseCiDemoArgv(["--out", "relative/reports"])).toThrow(messages.usage);
    expect(() => parseCiDemoArgv(["--out", "/tmp/reports", "--verbose"])).toThrow(messages.usage);
  });

  it("accepts a single absolute output directory", () => {
    expect(parseCiDemoArgv(["--out", "/var/ci/paymentchaos"])).toEqual({
      outDir: "/var/ci/paymentchaos",
    });
  });
});

describe("ci demo reports", () => {
  it("writes four machine reports with expected exits and verdicts", async () => {
    if (
      !existsSync(join(import.meta.dirname, "..", "..", "..", "packages", "cli", "dist", "bin.js"))
    ) {
      throw new Error(messages.missingBuild);
    }
    const outDir = await mkdtemp(join(tmpdir(), "paymentchaos-ci-demo-"));
    try {
      await runCiDemo(outDir);
      for (const name of Object.values(ciDemoReportNames)) {
        const path = join(outDir, name);
        expect(existsSync(path), name).toBe(true);
        const text = await readFile(path, "utf8");
        expect(text.length).toBeGreaterThan(32);
        expect(text).not.toContain("whsec_test_naive_example");
        expect(text).not.toContain("whsec_test_correct_example");
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
      await rm(outDir, { recursive: true, force: true });
    }
  }, 180_000);
});
