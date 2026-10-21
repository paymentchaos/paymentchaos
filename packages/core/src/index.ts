/**
 * `@paymentchaos/core` public surface.
 *
 * M0 ships the frozen contracts only: the scenario and project-config model, the
 * provider adapter interface, the deterministic runtime primitives, the delivery-plan
 * and run-report shapes, and the error contract. Engine implementations (PRNG, plan
 * compiler, operators, executor, assertions) land in M1 behind these contracts.
 */
export * from "./contracts/index.ts";
