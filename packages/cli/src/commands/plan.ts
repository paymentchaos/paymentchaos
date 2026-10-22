import { generateSeed } from "@paymentchaos/core";
import type { CommandDef } from "citty";
import { createEngine } from "../engine/create-engine.ts";
import { exitCodeFor } from "../exit.ts";
import { parseOptionalSeed } from "../flags.ts";
import { messages } from "../messages.ts";
import { mergeScenarioWithProject } from "../scenario/merge.ts";
import { loadResolvedScenario, resolveScenarioRef } from "../scenario/resolve.ts";
import { loadProjectConfig } from "../yaml/load.ts";

export function createPlanCommand(): CommandDef {
  return {
    meta: {
      name: "plan",
      description: "Print the compiled delivery plan and hash without sending webhooks.",
    },
    args: {
      file: {
        type: "positional",
        description: "Scenario YAML file",
        required: true,
      },
      seed: { type: "string", description: "PRNG seed" },
    },
    async run(ctx) {
      const file = ctx.args.file as string;
      const cwd = process.cwd();
      const project = await loadProjectConfig(cwd);
      const engine = await createEngine();

      try {
        let seedArg: number | undefined;
        try {
          seedArg = parseOptionalSeed(ctx.args.seed);
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exit(exitCodeFor(error));
        }

        const resolved = await resolveScenarioRef(cwd, file);
        const loaded = await loadResolvedScenario(resolved);
        const scenario = mergeScenarioWithProject(loaded.scenario, project?.config);
        const seed = seedArg ?? scenario.seed ?? generateSeed();

        console.log(messages.runSeedLine(seed));
        const plan = await engine.plan({ scenario, seed });
        console.log(messages.planHeading(plan.planHash));
        for (const delivery of plan.deliveries) {
          console.log(
            messages.planDelivery(
              delivery.seq,
              delivery.event.type,
              delivery.event.id,
              delivery.attempt,
            ),
          );
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(exitCodeFor(error));
      }
    },
  };
}
