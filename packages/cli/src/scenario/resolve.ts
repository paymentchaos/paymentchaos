import { access } from "node:fs/promises";
import path from "node:path";
import { PaymentChaosError } from "@paymentchaos/core";
import { messages } from "../messages.ts";
import { loadScenarioFile, projectScenarioPath } from "../yaml/load.ts";
import { BUILTIN_NAMES, findBuiltin } from "./builtins.ts";

function levenshtein(a: string, b: string): number {
  const dp = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) {
    dp[j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0] ?? 0;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min((dp[j - 1] ?? 0) + 1, (dp[j] ?? 0) + 1, prev + cost);
      prev = temp;
    }
  }
  return dp[b.length] ?? 0;
}

export function closestScenarioNames(
  input: string,
  candidates: readonly string[],
  limit = 3,
): string[] {
  const scored = candidates
    .map((name) => ({ name, distance: levenshtein(input, name) }))
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
  return scored
    .filter((s) => s.distance <= Math.max(3, Math.floor(input.length / 2)))
    .slice(0, limit)
    .map((s) => s.name);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export type ResolvedScenario =
  | { kind: "file"; ref: string; absolutePath: string }
  | { kind: "builtin"; ref: string };

export async function resolveScenarioRef(cwd: string, ref: string): Promise<ResolvedScenario> {
  const asPath = path.resolve(cwd, ref);
  if (await pathExists(asPath)) {
    return { kind: "file", ref, absolutePath: asPath };
  }

  const projectFile = projectScenarioPath(cwd, ref);
  if (await pathExists(projectFile)) {
    return { kind: "file", ref: path.relative(cwd, projectFile), absolutePath: projectFile };
  }

  const builtin = findBuiltin(ref);
  if (builtin !== undefined) {
    return { kind: "builtin", ref: builtin.name };
  }

  const suggestions = closestScenarioNames(ref, BUILTIN_NAMES);
  const hint = messages.didYouMean(suggestions);
  throw new PaymentChaosError(
    "SCENARIO_NOT_FOUND",
    `${messages.scenarioNotFound(ref)} ${hint}`.trim(),
    {
      details: { suggestions },
    },
  );
}

export async function loadResolvedScenario(resolved: ResolvedScenario) {
  if (resolved.kind === "file") {
    const scenario = await loadScenarioFile(resolved.absolutePath);
    return { scenario, ref: resolved.ref };
  }
  const builtin = findBuiltin(resolved.ref);
  if (builtin === undefined) {
    throw new PaymentChaosError("SCENARIO_NOT_FOUND", messages.scenarioNotFound(resolved.ref));
  }
  return { scenario: structuredClone(builtin), ref: resolved.ref };
}
