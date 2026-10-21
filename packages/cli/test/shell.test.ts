import { describe, expect, it } from "vitest";
import { messages } from "../src/messages.ts";

describe("assertion command shells", () => {
  it("documents platform quoting differences", () => {
    expect(messages.shellQuotingNote).toMatch(/Windows/);
    expect(messages.shellQuotingNote).toMatch(/Unix/);
  });
});
