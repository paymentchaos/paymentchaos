# ADR 0006: Safety — target guard and secret handling

Status: Accepted · 2026-10-21

## Context

PaymentChaos sends *validly signed* payment events. Pointed at a production endpoint with a real signing secret, it could grant real entitlements or corrupt real billing state. It also handles signing secrets and runs user-supplied commands. Safety is therefore a product feature, not a setting.

## Decision

**Target guard.** By default, refuse any target that is not loopback (`127.0.0.0/8`, `::1`), a private-network address (`10/8`, `172.16/12`, `192.168/16`, `fc00::/7`, link-local), or a hostname ending in `.localhost`, `.test` or `.internal`. Remote targets require an explicit `--allow-remote-target <host>` with a concrete host; no wildcards. The guard is enforced in `core` before any delivery is sent, not in the CLI, so every entry point is covered.

**Test-mode marking.** Every generated event is marked as test/sandbox using the provider's own convention (for example Stripe `livemode: false`).

**Secrets.** Secrets are referenced as `${ENV_VAR}` and resolved to a `SecretRef` at send time. They are never written to a scenario file, config file, log, report (terminal/json/junit/html), plan output, or error message. A redaction pass scrubs any known secret value from error text before display. Planning and reporting layers only ever see the `SecretRef`, never the resolved value.

**Assertion/hook commands.** Run with an explicit, documented environment: an allowlist plus `PAYMENTCHAOS_*` variables. The parent process's environment (which may hold the signing secret) is not passed through implicitly.

**Capture listener.** Binds to `127.0.0.1` by default. Captured payloads are stored locally only and are never uploaded (no telemetry).

## Consequences

- The remote-target guard and secret redaction are in scope for the pre-public security review (checkpoint 4).
- Reporters receive a model that structurally cannot contain a secret.
- Command injection via scenario/hook/assertion strings is an explicit threat to test against.
- A dedicated `RemoteTargetError` (exit `2`) is thrown with guidance when the guard blocks a target.
