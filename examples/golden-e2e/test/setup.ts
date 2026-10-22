import { createCoreScenarioRunner } from "../src/core-scenario-runner.js";
import { registerScenarioRunner } from "../src/scenario-runner.js";

registerScenarioRunner(createCoreScenarioRunner);
