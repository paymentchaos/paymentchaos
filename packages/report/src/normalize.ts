/** Normalize volatile fields in terminal output for snapshot tests. */

const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const LATENCY_MS = /\b\d+(?:\.\d+)?ms\b/g;
const RUN_ID = /runId=[a-zA-Z0-9_-]+/g;

export function normalizeTerminalOutput(text: string): string {
  return text
    .replace(ISO_TIMESTAMP, "<TIMESTAMP>")
    .replace(LATENCY_MS, "<LATENCY>")
    .replace(RUN_ID, "runId=<RUN_ID>");
}
