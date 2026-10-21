import type { Env } from "../safety/secrets.ts";

/**
 * The documented environment for assertion and hook commands (ADR 0005, ADR 0006).
 * The parent environment, which may hold the signing secret, is never passed through
 * implicitly: only these variables, explicit `passEnv` names and `PAYMENTCHAOS_*`.
 */
export const COMMAND_ENV_ALLOWLIST: readonly string[] = [
  // Needed to find and run tools (npm, python, go, …) on every platform.
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TERM",
  "CI",
  // Windows: cmd.exe, npm and most runtimes fail without these.
  "PATHEXT",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "COMSPEC",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
];

export interface RunMetadata {
  readonly runId: string;
  readonly seed: number;
  readonly planHash: string;
  /** 1-based repetition index within `repeat: N`. */
  readonly repeatIndex: number;
  /** Named ids, e.g. `{ customer: "cus_…" }`. */
  readonly ids: Readonly<Record<string, string>>;
}

export interface CommandEnvOptions {
  /** Extra parent variables the user explicitly opted in to. */
  readonly passEnv?: readonly string[];
  readonly parentEnv?: Env;
  readonly platform?: NodeJS.Platform;
}

/** `customer_2` → `CUSTOMER_2`; anything outside [A-Z0-9_] becomes `_`. */
const envSuffix = (name: string) => name.toUpperCase().replace(/[^A-Z0-9_]/g, "_");

export function buildCommandEnv(
  metadata: RunMetadata,
  options: CommandEnvOptions = {},
): Record<string, string> {
  const parent = options.parentEnv ?? process.env;
  // Windows variable names are case-insensitive ("Path" is PATH), POSIX names are not.
  const windows = (options.platform ?? process.platform) === "win32";
  const key = (name: string) => (windows ? name.toUpperCase() : name);
  const wanted = new Set([...COMMAND_ENV_ALLOWLIST, ...(options.passEnv ?? [])].map(key));

  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value !== undefined && wanted.has(key(name))) env[name] = value;
  }
  env.PAYMENTCHAOS = "1";
  env.PAYMENTCHAOS_RUN_ID = metadata.runId;
  env.PAYMENTCHAOS_SEED = String(metadata.seed);
  env.PAYMENTCHAOS_PLAN_HASH = metadata.planHash;
  env.PAYMENTCHAOS_REPEAT_INDEX = String(metadata.repeatIndex);
  env.PAYMENTCHAOS_IDS_JSON = JSON.stringify(metadata.ids);
  for (const [name, value] of Object.entries(metadata.ids)) {
    env[`PAYMENTCHAOS_ID_${envSuffix(name)}`] = value;
  }
  return env;
}
