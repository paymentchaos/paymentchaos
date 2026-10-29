import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectConfigSchema } from "@paymentchaos/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { initializeProject } from "../src/commands/init.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paymentchaos init café "));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const config = () =>
  projectConfigSchema.parse(parse(readFileSync(join(dir, "paymentchaos.config.yaml"), "utf8")));

describe("init", () => {
  it.each(["stripe", "razorpay", "generic-hmac"])(
    "creates valid %s config with a failing assertion",
    async (provider) => {
      const output = await initializeProject(dir, { provider, secretEnv: "SANDBOX_SECRET" });
      expect(config().providers?.[provider]?.target.secret).toBe("${SANDBOX_SECRET}");
      expect(config().assert?.command).toBe("node paymentchaos/verify.mjs");
      expect(output).toContain("Init sends no webhooks");
      const result = spawnSync(process.execPath, ["paymentchaos/verify.mjs"], {
        cwd: dir,
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout).checks[0].pass).toBe(false);
    },
  );

  it("detects a provider and framework without executing package scripts", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { razorpay: "*", express: "*" },
        scripts: { postinstall: "exit 9" },
      }),
    );
    expect(await initializeProject(dir)).toContain("Detected express");
    expect(config().providers?.razorpay?.target.secret).toBe("${RAZORPAY_WEBHOOK_SECRET}");
  });

  it("requires a choice for ambiguous dependencies and honors an explicit provider", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ devDependencies: { stripe: "*", razorpay: "*" } }),
    );
    await expect(initializeProject(dir)).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    expect(readdirSync(dir)).toEqual(["package.json"]);
    await initializeProject(dir, { provider: "stripe" });
    expect(config().providers?.stripe).toBeDefined();
  });

  it("defaults to Stripe and refuses a second initialization without changing files", async () => {
    await initializeProject(dir);
    const original = readFileSync(join(dir, "paymentchaos.config.yaml"));
    await expect(initializeProject(dir, { provider: "razorpay" })).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
    expect(readFileSync(join(dir, "paymentchaos.config.yaml"))).toEqual(original);
  });

  it("preserves an existing config and rolls back the new starter directory", async () => {
    writeFileSync(join(dir, "paymentchaos.config.yaml"), "user content");
    await expect(initializeProject(dir)).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    expect(readFileSync(join(dir, "paymentchaos.config.yaml"), "utf8")).toBe("user content");
    expect(existsSync(join(dir, "paymentchaos"))).toBe(false);
  });

  it("refuses an existing scaffold directory, including a directory symlink", async () => {
    const owned = join(dir, "user-owned");
    mkdirSync(owned);
    writeFileSync(join(owned, "verify.mjs"), "user content");
    symlinkSync(
      owned,
      join(dir, "paymentchaos"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(initializeProject(dir)).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    expect(readFileSync(join(owned, "verify.mjs"), "utf8")).toBe("user content");
    expect(existsSync(join(dir, "paymentchaos.config.yaml"))).toBe(false);
  });

  it.each([
    { provider: "unknown" },
    { secretEnv: "${SECRET}" },
    { secretEnv: "" },
    { secretEnv: "whsec_synthetic_private_key" },
    { secretEnv: "WHSEC_SYNTHETIC_PRIVATE_KEY" },
    { secretEnv: "SK_TEST_SYNTHETIC_KEY" },
    { secretEnv: "RK_TEST_SYNTHETIC_KEY" },
    { secretEnv: "RZP_TEST_SYNTHETIC_KEY" },
    { target: "invalid" },
    { target: "file:///tmp/webhook" },
    { target: "https://user:password@example.com/webhook" },
    { target: "http://localhost/hook?token=secret" },
    { target: "http://localhost/hook#fragment" },
    { target: "https://example.com/webhook" },
  ])("rejects invalid or unapproved options before writing: %j", async (options) => {
    await expect(initializeProject(dir, options)).rejects.toBeInstanceOf(Error);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("accepts an explicitly allowed remote host without persisting permission", async () => {
    await initializeProject(dir, {
      target: "https://example.com/hook",
      allowRemoteTarget: "example.com",
    });
    expect(config().providers?.stripe?.target.url).toBe("https://example.com/hook");
    expect(config()).not.toHaveProperty("allowRemoteTarget");
  });

  it("accepts a BOM-prefixed manifest and normalizes the endpoint", async () => {
    writeFileSync(join(dir, "package.json"), '\uFEFF{"dependencies":{"razorpay":"*"}}');
    await initializeProject(dir, { target: " HTTP://LOCALHOST:3000/hook " });
    expect(config().providers?.razorpay?.target.url).toBe("http://localhost:3000/hook");
  });

  it.each(["invalid json", "null", "[]"])("refuses a malformed manifest: %s", async (body) => {
    writeFileSync(join(dir, "package.json"), body);
    await expect(initializeProject(dir)).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    expect(readdirSync(dir)).toEqual(["package.json"]);
  });
});
