# Architecture Decision Records

Each ADR records one significant decision: its context, the choice, and its consequences. ADRs are immutable once accepted. To change a decision, add a new ADR that supersedes the old one and update the old one's status.

Changes to accepted decisions that touch `packages/core/src/contracts/**` also require the orchestrator's approval and, per the review rules, the human's.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-package-architecture.md) | Monorepo and package architecture | Accepted |
| [0002](0002-provider-adapter-and-signing.md) | Provider adapter and signing model | Accepted |
| [0003](0003-determinism.md) | Determinism, PRNG and plan hash | Accepted |
| [0004](0004-scenario-format.md) | Scenario and project config format | Accepted |
| [0005](0005-assertions.md) | Assertion protocol | Accepted |
| [0006](0006-safety.md) | Safety: target guard and secret handling | Accepted |
| [0007](0007-money-and-time.md) | Money and time conventions | Accepted |
| [0008](0008-toolchain.md) | Toolchain and versions | Accepted |
