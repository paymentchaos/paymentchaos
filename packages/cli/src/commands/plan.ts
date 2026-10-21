import type { CommandDef } from "citty";
import { createEngine } from "../engine/fake-engine.ts";
import { exitCodeFor } from "../exit.ts";
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
      const seedArg = ctx.args.seed as string | undefined;
      const cwd = process.cwd();
      const project = await loadProjectConfig(cwd);
      const engine = createEngine();

      try {
        const resolved = await resolveScenarioRef(cwd, file);
        const loaded = await loadResolvedScenario(resolved);
        let scenario = mergeScenarioWithProject(loaded.scenario, project?.config);
        const seed = seedArg !== undefined ? Number.parseInt(seedArg, 10) : (scenario.seed ?? 1);
        scenario = { ...scenario, seed };

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
