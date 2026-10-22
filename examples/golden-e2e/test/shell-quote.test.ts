import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { quoteShellArg, shellCommand } from "../src/shell-quote.js";

describe("quoteShellArg on POSIX", () => {
  it("wraps arguments in single quotes", () => {
    expect(quoteShellArg("/usr/local/bin/node", "linux")).toBe("'/usr/local/bin/node'");
    expect(quoteShellArg("/Users/Zoë Ångström/app", "darwin")).toBe("'/Users/Zoë Ångström/app'");
  });

  it("keeps $, backticks, double quotes and % literal", () => {
    expect(quoteShellArg('a $HOME `id` "x" %PATH%', "linux")).toBe(`'a $HOME \`id\` "x" %PATH%'`);
  });

  it("escapes embedded single quotes as '\\''", () => {
    expect(quoteShellArg("/home/o'brien/app", "linux")).toBe(`'/home/o'\\''brien/app'`);
  });
});

describe("quoteShellArg on Windows (cmd.exe)", () => {
  it("wraps arguments in double quotes", () => {
    expect(quoteShellArg("C:\\Program Files\\nodejs\\node.exe", "win32")).toBe(
      '"C:\\Program Files\\nodejs\\node.exe"',
    );
    expect(quoteShellArg("C:\\Users\\Zoë (dev) & co\\app", "win32")).toBe(
      '"C:\\Users\\Zoë (dev) & co\\app"',
    );
  });

  it.each([
    ['C:\\a "b"\\app', '"'],
    ["C:\\100%\\app", "%"],
    ["C:\\a\nb", "newline"],
    ["C:\\a\r\nb", "carriage return"],
  ])("refuses %j (%s)", (arg) => {
    expect(() => quoteShellArg(arg, "win32")).toThrow(/cmd\.exe.*", % or a line break/);
  });
});

describe("shellCommand", () => {
  it("joins quoted arguments for the given platform", () => {
    expect(shellCommand(["node", "--import", "file:///x y/l.mjs"], "linux")).toBe(
      "'node' '--import' 'file:///x y/l.mjs'",
    );
    expect(shellCommand(["node", "--import", "file:///C:/x y/l.mjs"], "win32")).toBe(
      '"node" "--import" "file:///C:/x y/l.mjs"',
    );
  });
});

describe("on this host's shell", () => {
  // Same spawn mode core uses for assertion commands: /bin/sh -c, or cmd.exe /d /s /c.
  it("delivers every argument to the child unchanged", () => {
    const args = ["my app", "Zoë Ångström 山田太郎", "a & b | (c) <d>", "it's", "$HOME `id`"];
    const command = shellCommand(
      [
        process.execPath,
        "-e",
        "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
        ...args,
      ],
      process.platform,
    );
    const result = spawnSync(command, { shell: true, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(args);
  });
});
