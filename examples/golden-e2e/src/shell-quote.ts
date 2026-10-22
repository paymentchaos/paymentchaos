/**
 * Quote arguments for the shell `paymentchaos` runs assertion commands in: `/bin/sh -c` on
 * POSIX and `cmd.exe /d /s /c` on Windows (Node's `shell: true`, see
 * https://nodejs.org/api/child_process.html#shell-requirements).
 */

/** Characters cmd.exe cannot carry safely inside a double-quoted argument. */
const CMD_UNSAFE = /["%\r\n]/;

export function quoteShellArg(arg: string, platform: NodeJS.Platform): string {
  if (platform === "win32") {
    // Inside double quotes cmd.exe still expands %VAR%, and it has no escape for `"` that
    // survives the child's own argument parsing, so refuse rather than build a broken command.
    if (CMD_UNSAFE.test(arg)) {
      throw new Error(
        `Cannot quote ${JSON.stringify(arg)} for cmd.exe: it contains ", % or a line break. Move the file to a path without those characters.`,
      );
    }
    return `"${arg}"`;
  }
  // POSIX single quotes are fully literal; a single quote is closed, escaped and reopened.
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

export function shellCommand(args: readonly string[], platform: NodeJS.Platform): string {
  return args.map((arg) => quoteShellArg(arg, platform)).join(" ");
}
