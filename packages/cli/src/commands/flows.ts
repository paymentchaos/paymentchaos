import type { CommandDef } from "citty";
import { createEngine } from "../engine/fake-engine.ts";
import { messages } from "../messages.ts";

export function createFlowsCommand(): CommandDef {
  return {
    meta: {
      name: "flows",
      description: "List lifecycle packs available for each provider.",
    },
    args: {
      provider: {
        type: "positional",
        description: "Optional provider id filter (e.g. stripe)",
        required: false,
      },
    },
    run(ctx) {
      const provider = ctx.args.provider as string | undefined;
      const engine = createEngine();
      const flows = engine.listFlows(provider);
      console.log(messages.flowsHeading);
      for (const flow of flows) {
        console.log(messages.flowsRow(flow.provider, flow.id, flow.title, flow.events.join(", ")));
      }
    },
  };
}
