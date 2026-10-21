import type { DeliveryPlan, Env, RunReport, Scenario } from "@paymentchaos/core";

/** Options passed from the CLI into the core run surface (integration seam). */
export interface RunEngineOptions {
  readonly scenario: Scenario;
  readonly cwd: string;
  /** When omitted, core picks a random seed and returns it on the report. */
  readonly seed?: number;
  readonly repeat: number;
  readonly repeatIndex?: number;
  readonly allowRemoteTarget?: string;
  readonly stableIds?: boolean;
  /** Secret resolution for runs (defaults to `process.env`). */
  readonly env?: Env;
}

export interface PlanEngineOptions {
  readonly scenario: Scenario;
  readonly seed: number;
}

export interface FlowListing {
  readonly provider: string;
  readonly id: string;
  readonly title: string;
  readonly events: readonly string[];
}

export interface RunEngineResult {
  readonly report: RunReport;
  readonly notes: readonly string[];
  /** 1-based index of the first failed repeat, when any repetition failed. */
  readonly failedRepeatIndex?: number;
}

/** Single integration point for `@paymentchaos/core` execution. */
export interface PaymentChaosEngine {
  run(options: RunEngineOptions): Promise<RunEngineResult>;
  plan(options: PlanEngineOptions): Promise<DeliveryPlan>;
  listFlows(providerFilter?: string): readonly FlowListing[];
}
