import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");
const pkg = JSON.parse(read("package.json")) as {
  packageManager: string;
  engines: { node: string };
};

describe("toolchain pins", () => {
  const nodeVersion = read(".node-version").trim();
  const pnpmVersion = pkg.packageManager.replace(/^pnpm@/, "");

  it("pins an exact Node 24 version consistently", () => {
    expect(nodeVersion).toMatch(/^24\.\d+\.\d+$/);
    expect(read(".nvmrc").trim()).toBe(nodeVersion);
  });

  it("pins an exact pnpm version through packageManager", () => {
    expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
  });

  it("supports Node 22.12 or newer", () => {
    expect(pkg.engines.node).toBe(">=22.12.0");
  });

  it("runs CI on the pinned and minimum supported Node versions", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain(`"${nodeVersion}"`);
    expect(ci).toContain(`"${pkg.engines.node.replace(/^>=/, "")}"`);
  });

  it("records the pinned versions in the README", () => {
    const readme = read("README.md");
    expect(readme).toContain(nodeVersion);
    expect(readme).toContain(pnpmVersion);
  });
});

describe("fixture byte safety", () => {
  it("disables line-ending conversion for webhook fixtures", () => {
    const attributes = read(".gitattributes");
    expect(attributes).toMatch(/^\*\*\/fixtures\/\*\* -text$/m);
    expect(attributes).toMatch(/^\*\.fixture\.json -text$/m);
  });
});
