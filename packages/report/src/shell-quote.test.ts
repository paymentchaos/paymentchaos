import { describe, expect, it } from "vitest";
import { quoteShellArg } from "./shell-quote.ts";

describe("quoteShellArg", () => {
  it("leaves simple paths unquoted", () => {
    expect(quoteShellArg("renewal.yaml")).toBe("renewal.yaml");
  });

  it("quotes paths with spaces", () => {
    const quoted = quoteShellArg("my scenarios/renewal.yaml");
    // cmd.exe has no single-quote quoting, so Windows uses double quotes.
    expect(quoted).toMatch(process.platform === "win32" ? /^".+"$/ : /^'.+'$/);
    expect(quoted).toContain("my scenarios");
  });
});
