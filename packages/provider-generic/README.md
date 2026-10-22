# @paymentchaos/provider-generic

`createGenericAdapter({ params, env? })` implements `generic-hmac` / `user-event`.
It signs developer-supplied payloads; it invents no provider event schema.
Configure one adapter per scenario. The CLI passes `scenario.params` to the factory;
programmatic callers must do the same before calling core's `compilePlan` or
`runScenario`. No change to the frozen core contracts is required.

Payloads are **inline UTF-8 strings**, not filenames or parsed objects. YAML `|`
retains its final newline and `|-` removes it. `encode` produces bytes once;
redeliveries reuse them. No JSON parse/re-serialization or file resolution occurs.
`x-paymentchaos-mode: test` marks every delivery without altering supplied bodies.
`identify` returns null because arbitrary bytes have no provider event envelope.

```yaml
params:
  format: standard-webhooks
  events:
    - type: custom.created
      body: |
        { "type": "custom.created", "name": "Zoë 東京", "test": true }
    - type: custom.updated
      body: '{"type":"custom.updated","test":true}'
```

`format` defaults to `raw-body-hex`: SHA256, hex, no prefix, `{body}`,
`x-webhook-signature`. Custom formats specify all of these keys (`prefix` defaults
to empty):

```yaml
format:
  header: X-Signature
  algorithm: sha512 # sha256 | sha1 | sha512
  encoding: base64 # hex | base64
  prefix: 'sha512='
  template: '{id}.{timestamp}.{body}'
```

Tokens are replaced with byte chunks. `{body}` is required; only `{id}` and
`{timestamp}` are also recognized. IDs are deterministic per logical event;
timestamps are delivery UTC Unix seconds. Raw/custom formats send metadata in
`x-webhook-id` and `x-webhook-timestamp`. Signature header names must be HTTP tokens
and cannot overwrite transport headers or metadata. Validation raises typed
`CONFIG_INVALID` errors with `params` paths and never includes supplied values.
Unknown params keys are rejected; shared `currency` and `country` keys are allowed.

The `standard-webhooks` preset uses HMAC-SHA256, `{id}.{timestamp}.{body}`,
`webhook-id`, `webhook-timestamp`, and `webhook-signature: v1,<base64>`.
Secrets must be `whsec_` plus canonical base64 of 24–64 bytes, decoded before HMAC.
It signs with current and previous keys using space-separated signatures. All
formats verify previous keys; raw/custom formats sign only with the current key
because arbitrary configured formats define no multiple-signature syntax.
Standard verification applies a local ±300-second tolerance matching the official
JavaScript SDK 1.0.0. Raw/custom timestamps have no implicit tolerance policy.
Misconfigured key references or malformed Standard Webhooks secrets raise typed
errors during both signing and verification; an unauthentic request returns
`{ valid: false }`.

Official specification and oracle:
- https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md
- https://github.com/standard-webhooks/standard-webhooks/tree/main/libraries/javascript

The standard recommends retry schedules and timeout ranges; it does not define a
provider's exact timing. Delivery profile timings are therefore null. Local
execution timeout and deterministic chaos are controlled by PaymentChaos.
Runtime dependency: zod validates developer signing formats and payload entries.
The official `standardwebhooks` package is a development-only signature oracle.
