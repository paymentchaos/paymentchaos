import type { DeliveryPlan, RunReport, Scenario } from "@paymentchaos/core";

/** Options passed from the CLI into the core run surface (integration seam). */
export interface RunEngineOptions {
  readonly scenario: Scenario;
  readonly cwd: string;
  readonly seed: number;
  readonly repeat: number;
  readonly repeatIndex?: number;
  readonly allowRemoteTarget?: string;
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

/**
 * Single integration point for `@paymentchaos/core` execution.
 * Replace {@link createFakeEngine} with `createCoreEngine` when the engine lands on main.
 */
export interface PaymentChaosEngine {
  run(options: RunEngineOptions): Promise<RunReport>;
  plan(options: PlanEngineOptions): Promise<DeliveryPlan>;
  listFlows(providerFilter?: string): readonly FlowListing[];
}
