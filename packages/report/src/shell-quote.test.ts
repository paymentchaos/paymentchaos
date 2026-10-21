import { describe, expect, it } from "vitest";
import { quoteShellArg } from "./shell-quote.ts";

describe("quoteShellArg", () => {
  it("leaves simple paths unquoted", () => {
    expect(quoteShellArg("renewal.yaml")).toBe("renewal.yaml");
  });

  it("quotes paths with spaces", () => {
    const quoted = quoteShellArg("my scenarios/renewal.yaml");
    expect(quoted).toMatch(/^'.+'$/);
    expect(quoted).toContain("my scenarios");
  });
});
