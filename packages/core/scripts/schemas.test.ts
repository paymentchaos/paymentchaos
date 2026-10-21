import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCHEMA_FILES, serialize } from "./schemas.ts";

const here = dirname(fileURLToPath(import.meta.url));
const schemasDir = join(here, "..", "..", "..", "schemas");

describe("generated JSON schemas", () => {
  for (const [file, schema] of Object.entries(SCHEMA_FILES)) {
    it(`schemas/${file} is committed and up to date`, () => {
      const onDisk = readFileSync(join(schemasDir, file), "utf8");
      expect(onDisk).toBe(serialize(schema));
    });
  }
});
