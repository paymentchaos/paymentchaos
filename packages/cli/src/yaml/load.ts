import { access, readFile } from "node:fs/promises";
import path from "node:path";
import {
  PaymentChaosError,
  type ProjectConfig,
  projectConfigSchema,
  type Scenario,
  scenarioSchema,
} from "@paymentchaos/core";
import {
  type Alias,
  isMap,
  isScalar,
  LineCounter,
  type ParsedNode,
  parseDocument,
  visit,
} from "yaml";
import { messages } from "../messages.ts";

const CONFIG_FILE = "paymentchaos.config.yaml";
const SCENARIOS_DIR = path.join("paymentchaos", "scenarios");

export { CONFIG_FILE, SCENARIOS_DIR };

function nodeLine(lineCounter: LineCounter, node: ParsedNode | null | undefined): number {
  if (node?.range === undefined) {
    return 1;
  }
  return lineCounter.linePos(node.range[0]).line;
}

function getNodeAtPath(
  doc: ReturnType<typeof parseDocument>,
  issuePath: PropertyKey[],
): ParsedNode | null {
  if (issuePath.length === 0) {
    return doc.contents as ParsedNode | null;
  }
  const node = doc.getIn(issuePath, true);
  return (node as ParsedNode | null) ?? null;
}

function hintForIssue(code: string, message: string): string {
  if (message.includes("${") || message.includes("secret")) {
    return "use an environment reference like ${STRIPE_WEBHOOK_SECRET}, never a literal secret";
  }
  if (code === "invalid_value" && message.includes("version")) {
    return "set version: 1 at the top of the file";
  }
  if (code === "invalid_format" && message.includes("url")) {
    return "use a full URL such as http://localhost:3000/webhooks/stripe";
  }
  return "fix the value to match the scenario schema";
}

function unknownKeyNode(parent: ParsedNode | null, key: string | undefined): ParsedNode | null {
  if (!isMap(parent) || key === undefined) {
    return null;
  }
  const pair = parent.items.find((item) => isScalar(item.key) && String(item.key.value) === key);
  return (pair?.key as ParsedNode | undefined) ?? null;
}

function assertValid<T>(
  schema: {
    safeParse: (value: unknown) =>
      | { success: true; data: T }
      | {
          success: false;
          error: {
            issues: { path: PropertyKey[]; message: string; code: string; keys?: string[] }[];
          };
        };
  },
  value: unknown,
  filePath: string,
  doc: ReturnType<typeof parseDocument>,
  lineCounter: LineCounter,
): T {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  const issue = result.error.issues[0];
  if (issue === undefined) {
    throw new PaymentChaosError("CONFIG_INVALID", `Invalid YAML in ${filePath}`);
  }
  const node = getNodeAtPath(doc, issue.path);
  if (issue.code === "unrecognized_keys") {
    // zod quotes the key, and a mistyped line can make the key a pasted secret. Point at it instead.
    const keyNode = unknownKeyNode(node, issue.keys?.[0]);
    const pos = keyNode?.range ? lineCounter.linePos(keyNode.range[0]) : { line: 1, col: 1 };
    const line = keyNode ? pos.line : nodeLine(lineCounter, node);
    throw new PaymentChaosError(
      "CONFIG_INVALID",
      messages.yamlUnknownKey(filePath, line, keyNode ? pos.col : undefined),
      { details: { file: filePath, line } },
    );
  }
  const line = nodeLine(lineCounter, node);
  const hint = hintForIssue(issue.code, issue.message);
  throw new PaymentChaosError(
    "CONFIG_INVALID",
    messages.yamlValidation(filePath, line, issue.message, hint),
    { details: { file: filePath, line, path: issue.path.map(String) } },
  );
}

async function readYamlDocument(filePath: string): Promise<{
  absolute: string;
  doc: ReturnType<typeof parseDocument>;
  lineCounter: LineCounter;
  value: unknown;
}> {
  const absolute = path.resolve(filePath);
  let source: string;
  try {
    source = await readFile(absolute, "utf8");
  } catch (cause) {
    throw new PaymentChaosError("CONFIG_INVALID", `Cannot read ${absolute}`, { cause });
  }

  const lineCounter = new LineCounter();
  const doc = parseDocument(source, { lineCounter, strict: true });
  const err = doc.errors[0];
  if (err !== undefined) {
    // err.message quotes the offending source line, so only its position and code are reported.
    const pos = err.linePos?.[0] ?? { line: 1, col: 1 };
    throw new PaymentChaosError(
      "CONFIG_INVALID",
      messages.yamlSyntax(absolute, pos.line, pos.col, err.code),
      { details: { file: absolute, line: pos.line, column: pos.col, yamlCode: err.code } },
    );
  }

  let value: unknown;
  try {
    value = doc.toJSON();
  } catch {
    // toJSON throws a ReferenceError naming the alias for an unresolved alias or an alias bomb.
    throw aliasError(doc, lineCounter, absolute);
  }
  return { absolute, doc, lineCounter, value };
}

function aliasError(
  doc: ReturnType<typeof parseDocument>,
  lineCounter: LineCounter,
  file: string,
): PaymentChaosError {
  let first: Alias | undefined;
  let unresolved: Alias | undefined;
  visit(doc, {
    Alias(_key, node) {
      first ??= node;
      if (node.resolve(doc) === undefined) {
        unresolved = node;
        return visit.BREAK;
      }
      return undefined;
    },
  });
  const node = unresolved ?? first;
  const pos = node?.range ? lineCounter.linePos(node.range[0]) : { line: 1, col: 1 };
  const message =
    unresolved === undefined
      ? messages.yamlAliasLimit(file, pos.line, pos.col)
      : messages.yamlUnresolvedAlias(file, pos.line, pos.col);
  return new PaymentChaosError("CONFIG_INVALID", message, {
    details: { file, line: pos.line, column: pos.col },
  });
}

export async function loadScenarioFile(filePath: string): Promise<Scenario> {
  const { absolute, doc, lineCounter, value } = await readYamlDocument(filePath);
  return assertValid(scenarioSchema, value, absolute, doc, lineCounter);
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "ENOENT"
  );
}

export async function loadProjectConfig(
  startDir: string,
): Promise<{ path: string; config: ProjectConfig } | null> {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;

  while (true) {
    const candidate = path.join(dir, CONFIG_FILE);
    try {
      await access(candidate);
    } catch (error) {
      if (!isEnoent(error)) {
        throw error;
      }
      if (dir === root) {
        return null;
      }
      dir = path.dirname(dir);
      continue;
    }

    const { absolute, doc, lineCounter, value } = await readYamlDocument(candidate);
    const config = assertValid(projectConfigSchema, value, absolute, doc, lineCounter);
    return { path: candidate, config };
  }
}

export function projectScenarioPath(cwd: string, name: string): string {
  return path.join(cwd, SCENARIOS_DIR, `${name}.yaml`);
}
