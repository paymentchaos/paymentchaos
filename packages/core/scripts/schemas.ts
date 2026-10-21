import * as z from "zod";
import { runReportSchema } from "../src/contracts/report.ts";
import { projectConfigSchema, scenarioSchema } from "../src/contracts/scenario.ts";

/** The published JSON Schemas, keyed by their file name under `/schemas`. */
export const SCHEMA_FILES: Record<string, unknown> = {
  // Author-facing schemas describe what a human writes, so defaulted/optional fields
  // are not required (io: "input"). The report schema describes machine output.
  "scenario.v1.json": z.toJSONSchema(scenarioSchema, { target: "draft-2020-12", io: "input" }),
  "project-config.v1.json": z.toJSONSchema(projectConfigSchema, {
    target: "draft-2020-12",
    io: "input",
  }),
  "report.v1.json": z.toJSONSchema(runReportSchema, { target: "draft-2020-12" }),
};

/** Stable, newline-terminated JSON for writing and comparing. */
export function serialize(schema: unknown): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}
