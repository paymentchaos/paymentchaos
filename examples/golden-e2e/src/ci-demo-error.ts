export type CiDemoErrorCode =
  | "USAGE"
  | "BUILD_MISSING"
  | "OUTPUT_INVALID"
  | "CLI_TIMEOUT"
  | "CLI_START_FAILED"
  | "CLI_EXIT"
  | "SECRET_IN_OUTPUT"
  | "REPORT_INVALID";

export class CiDemoError extends Error {
  readonly code: CiDemoErrorCode;

  constructor(code: CiDemoErrorCode, message: string) {
    super(message);
    this.name = "CiDemoError";
    this.code = code;
  }
}
