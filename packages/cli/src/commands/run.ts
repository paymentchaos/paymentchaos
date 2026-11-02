import { glob, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PaymentChaosError, type RunReport } from "@paymentchaos/core";
import { renderJsonReport, renderJunitReport, renderTerminalReport } from "@paymentchaos/report";
import type { CommandDef } from "citty";
import { createEngine } from "../engine/create-engine.ts";
import { ExitCode, exitCodeForReport } from "../exit.ts";
import { parseOptionalPositiveInt, parseOptionalSeed } from "../flags.ts";
import { messages } from "../messages.ts";
import { mergeScenarioWithProject } from "../scenario/merge.ts";
import { loadResolvedScenario, resolveScenarioRef } from "../scenario/resolve.ts";
import { loadProjectConfig } from "../yaml/load.ts";

function hasGlobMagic(ref: string): boolean {
  return ref.includes("*") || ref.includes("?") || ref.includes("[");
}

async function expandScenarioArgs(cwd: string, args: readonly string[]): Promise<string[]> {
  const expanded: string[] = [];
  for (const arg of args) {
    if (hasGlobMagic(arg)) {
      const matches: string[] = [];
      for await (const entry of glob(arg, { cwd })) {
        matches.push(entry);
      }
      if (matches.length === 0) {
        expanded.push(arg);
      } else {
        expanded.push(...matches.sort());
      }
    } else {
      expanded.push(arg);
    }
  }
  return expanded;
}

export function createRunCommand(): CommandDef {
  return {
    meta: {
      name: "run",
      description: "Run one or more scenarios against the configured target.",
    },
    args: {
      seed: { type: "string", description: messages.runArgSeed },
      repeat: { type: "string", description: messages.runArgRepeat },
      "repeat-index": { type: "string", description: messages.runArgRepeatIndex },
      reporter: { type: "string", description: messages.runArgReporter, default: "terminal" },
      out: { type: "string", description: messages.runArgOut },
      "allow-remote-target": { type: "string", description: messages.runArgAllowRemoteTarget },
      "stable-ids": { type: "boolean", description: messages.runArgStableIds },
      "timeout-ms": { type: "string", description: messages.runArgTimeoutMs },
    },
    async run(ctx) {
      const positional = ctx.args._ ?? [];
      if (positional.length === 0) {
        throw new PaymentChaosError("CONFIG_INVALID", messages.runRequiresScenario);
      }

      const reporter = (ctx.args.reporter as string | undefined) ?? "terminal";
      if (!["terminal", "json", "junit"].includes(reporter)) {
        throw new PaymentChaosError("CONFIG_INVALID", messages.reporterUnknown(reporter));
      }

      const seedFlag = parseOptionalSeed(ctx.args.seed);
      const repeatFlag = parseOptionalPositiveInt(ctx.args.repeat, "repeat");
      const repeatIndex = parseOptionalPositiveInt(ctx.args["repeat-index"], "repeat-index");
      const timeoutMillis = parseOptionalPositiveInt(ctx.args["timeout-ms"], "timeout-ms");

      const allowRemoteTarget = ctx.args["allow-remote-target"] as string | undefined;
      const stableIds = ctx.args["stable-ids"] === true;
      const outPath = ctx.args.out as string | undefined;

      const cwd = process.cwd();
      const project = await loadProjectConfig(cwd);
      const engine = await createEngine();
      const refs = await expandScenarioArgs(cwd, positional);

      let lastExit: ExitCode = ExitCode.Ok;
      const reports: RunReport[] = [];
      let output = "";

      for (const ref of refs) {
        const resolved = await resolveScenarioRef(cwd, ref);
        const loaded = await loadResolvedScenario(resolved);
        let scenario = loaded.scenario;
        if (repeatFlag !== undefined) {
          scenario = { ...scenario, repeat: repeatFlag };
        }
        scenario = mergeScenarioWithProject(scenario, project?.config);

        const effectiveSeed = seedFlag ?? scenario.seed;
        const effectiveRepeat = scenario.repeat ?? repeatFlag ?? 1;

        const outcome = await engine.run({
          scenario,
          cwd,
          ...(effectiveSeed !== undefined ? { seed: effectiveSeed } : {}),
          repeat: effectiveRepeat,
          ...(repeatIndex !== undefined ? { repeatIndex } : {}),
          ...(allowRemoteTarget !== undefined ? { allowRemoteTarget } : {}),
          ...(stableIds ? { stableIds: true } : {}),
          ...(timeoutMillis !== undefined ? { timeoutMillis } : {}),
        });

        reports.push(outcome.report);
        const code = exitCodeForReport(outcome.report);
        if (code !== ExitCode.Ok) {
          lastExit = code;
        }
        if (reporter !== "terminal") continue;

        console.log(messages.runSeedLine(outcome.report.seed));

        const scenarioRef = resolved.kind === "file" ? path.normalize(loaded.ref) : loaded.ref;
        const scenarioRepeat = outcome.scenarioRepeat;
        let failedRepeatIndex = outcome.failedRepeatIndex;
        if (failedRepeatIndex === undefined && outcome.report.status !== "passed") {
          failedRepeatIndex = repeatIndex;
        }

        const text = renderTerminalReport(outcome.report, {
          cliCommand: [process.execPath, fileURLToPath(new URL("../bin.js", import.meta.url))],
          runArgs: [
            ...(stableIds ? ["--stable-ids"] : []),
            ...(timeoutMillis !== undefined ? ["--timeout-ms", String(timeoutMillis)] : []),
            ...(allowRemoteTarget !== undefined
              ? ["--allow-remote-target", allowRemoteTarget]
              : []),
          ],
          scenarioRef,
          ...(scenarioRepeat !== undefined ? { scenarioRepeat } : {}),
          ...(repeatIndex !== undefined ? { repeatSelection: true } : {}),
          ...(failedRepeatIndex !== undefined ? { failedRepeatIndex } : {}),
          ...(outcome.notes.length > 0 ? { notes: outcome.notes } : {}),
          color: process.stdout.isTTY,
        });

        process.stdout.write(text);
        output += text;
      }

      if (reporter !== "terminal") {
        output =
          reporter === "json"
            ? renderJsonReport(reports.length === 1 && reports[0] ? reports[0] : reports)
            : renderJunitReport(reports);
        process.stdout.write(output);
      }
      if (outPath !== undefined) {
        const destination = path.resolve(cwd, outPath);
        try {
          await writeFile(destination, output, "utf8");
        } catch {
          throw new PaymentChaosError("CONFIG_INVALID", messages.reportWriteFailed(destination));
        }
      }

      // Never process.exit() here: it can cut off stdout that is still draining into a pipe.
      process.exitCode = lastExit;
    },
  };
}
