/**
 * Quote a single argument for reproduction commands. Prefer single quotes on Unix;
 * on Windows use double quotes (cmd.exe). See CLI shellQuotingNote for full guidance.
 */
export function quoteShellArg(arg: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(arg)) {
    return arg;
  }
  if (process.platform === "win32") {
    return `"${arg.replace(/"/g, '""')}"`;
  }
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}
