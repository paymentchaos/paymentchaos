import { glob, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderTerminalReport } from "@paymentchaos/report";
import type { CommandDef } from "citty";
import { createEngine } from "../engine/create-engine.ts";
import { ExitCode, exitCodeFor, exitCodeForReport } from "../exit.ts";
import { parseOptionalPositiveInt, parseOptionalSeed } from "../flags.ts";
import { messages } from "../messages.ts";
import { mergeScenarioWithProject } from "../scenario/merge.ts";
import {
  loadResolvedScenario,
  type ResolvedScenario,
  resolveScenarioRef,
} from "../scenario/resolve.ts";
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
        console.error(messages.runRequiresScenario);
        process.exit(ExitCode.Config);
      }

      const reporter = (ctx.args.reporter as string | undefined) ?? "terminal";
      if (reporter !== "terminal") {
        console.error(messages.reporterUnknown(reporter));
        process.exit(ExitCode.Config);
      }

      let seedFlag: number | undefined;
      let repeatFlag: number | undefined;
      let repeatIndex: number | undefined;
      let timeoutMillis: number | undefined;
      try {
        seedFlag = parseOptionalSeed(ctx.args.seed);
        repeatFlag = parseOptionalPositiveInt(ctx.args.repeat, "repeat");
        repeatIndex = parseOptionalPositiveInt(ctx.args["repeat-index"], "repeat-index");
        timeoutMillis = parseOptionalPositiveInt(ctx.args["timeout-ms"], "timeout-ms");
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(exitCodeFor(error));
      }

      const allowRemoteTarget = ctx.args["allow-remote-target"] as string | undefined;
      const stableIds = ctx.args["stable-ids"] === true;
      const outPath = ctx.args.out as string | undefined;

      const cwd = process.cwd();
      let project: Awaited<ReturnType<typeof loadProjectConfig>>;
      let engine: Awaited<ReturnType<typeof createEngine>>;
      let refs: string[];
      try {
        project = await loadProjectConfig(cwd);
        engine = await createEngine();
        refs = await expandScenarioArgs(cwd, positional);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(exitCodeFor(error));
      }

      let lastExit: (typeof ExitCode)[keyof typeof ExitCode] = ExitCode.Ok;

      for (const ref of refs) {
        let resolved: ResolvedScenario;
        let loaded: Awaited<ReturnType<typeof loadResolvedScenario>>;
        try {
          resolved = await resolveScenarioRef(cwd, ref);
          loaded = await loadResolvedScenario(resolved);
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exit(exitCodeFor(error));
        }
        let scenario = loaded.scenario;
        if (repeatFlag !== undefined) {
          scenario = { ...scenario, repeat: repeatFlag };
        }

        try {
          scenario = mergeScenarioWithProject(scenario, project?.config);
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exit(exitCodeFor(error));
        }

        const effectiveSeed = seedFlag ?? scenario.seed;
        const effectiveRepeat = scenario.repeat ?? repeatFlag ?? 1;

        let outcome: Awaited<ReturnType<typeof engine.run>>;
        try {
          outcome = await engine.run({
            scenario,
            cwd,
            ...(effectiveSeed !== undefined ? { seed: effectiveSeed } : {}),
            repeat: effectiveRepeat,
            ...(repeatIndex !== undefined ? { repeatIndex } : {}),
            ...(allowRemoteTarget !== undefined ? { allowRemoteTarget } : {}),
            ...(stableIds ? { stableIds: true } : {}),
            ...(timeoutMillis !== undefined ? { timeoutMillis } : {}),
          });
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exit(exitCodeFor(error));
        }

        console.log(messages.runSeedLine(outcome.report.seed));

        const scenarioRef = resolved.kind === "file" ? path.normalize(loaded.ref) : loaded.ref;
        const scenarioRepeat = outcome.scenarioRepeat;
        let failedRepeatIndex = outcome.failedRepeatIndex;
        if (failedRepeatIndex === undefined && outcome.report.status !== "passed") {
          failedRepeatIndex = repeatIndex;
        }

        const text = renderTerminalReport(outcome.report, {
          scenarioRef,
          ...(scenarioRepeat !== undefined ? { scenarioRepeat } : {}),
          ...(repeatIndex !== undefined ? { repeatSelection: true } : {}),
          ...(failedRepeatIndex !== undefined ? { failedRepeatIndex } : {}),
          ...(outcome.notes.length > 0 ? { notes: outcome.notes } : {}),
          color: process.stdout.isTTY,
        });

        process.stdout.write(text);
        if (outPath !== undefined) {
          await writeFile(path.resolve(cwd, outPath), text, "utf8");
        }

        const code = exitCodeForReport(outcome.report);
        if (code !== ExitCode.Ok) {
          lastExit = code;
        }
      }

      process.exit(lastExit);
    },
  };
}
