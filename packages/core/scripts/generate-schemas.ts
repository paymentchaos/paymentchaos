import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_FILES, serialize } from "./schemas.ts";

/** Write the generated JSON Schemas into the repo-root `/schemas` directory. */
const here = dirname(fileURLToPath(import.meta.url));
const schemasDir = join(here, "..", "..", "..", "schemas");
mkdirSync(schemasDir, { recursive: true });

for (const [file, schema] of Object.entries(SCHEMA_FILES)) {
  writeFileSync(join(schemasDir, file), serialize(schema));
  process.stdout.write(`wrote schemas/${file}\n`);
}
