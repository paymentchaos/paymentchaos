/**
 * Error contract. Process exit codes are stable and part of the CLI's public interface
 * (see ADR 0005). User-facing errors say what happened, where, and how to fix it, and
 * never contain a secret (see ADR 0006).
 */

export const ExitCode = {
  Ok: 0,
  AssertionFailed: 1,
  Config: 2,
  TargetUnreachable: 3,
  Internal: 4,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export type ErrorCode =
  | "CONFIG_INVALID"
  | "SCENARIO_NOT_FOUND"
  | "REMOTE_TARGET_BLOCKED"
  | "SECRET_MISSING"
  | "TARGET_UNREACHABLE"
  | "SIGNING_FAILED"
  | "ASSERTION_FAILED"
  | "INTERNAL";

const EXIT_BY_CODE: Record<ErrorCode, ExitCode> = {
  CONFIG_INVALID: ExitCode.Config,
  SCENARIO_NOT_FOUND: ExitCode.Config,
  REMOTE_TARGET_BLOCKED: ExitCode.Config,
  SECRET_MISSING: ExitCode.Config,
  TARGET_UNREACHABLE: ExitCode.TargetUnreachable,
  SIGNING_FAILED: ExitCode.Internal,
  ASSERTION_FAILED: ExitCode.AssertionFailed,
  INTERNAL: ExitCode.Internal,
};

export interface PaymentChaosErrorOptions {
  /** Structured context for the report. Must never include secret values. */
  readonly details?: Record<string, unknown>;
  readonly cause?: unknown;
}

/** The single error type thrown across PaymentChaos packages. */
export class PaymentChaosError extends Error {
  readonly code: ErrorCode;
  readonly exitCode: ExitCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, options: PaymentChaosErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "PaymentChaosError";
    this.code = code;
    this.exitCode = EXIT_BY_CODE[code];
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}

/** Map any thrown value to a process exit code. */
export function exitCodeFor(error: unknown): ExitCode {
  return error instanceof PaymentChaosError ? error.exitCode : ExitCode.Internal;
}
