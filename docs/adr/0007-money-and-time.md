# ADR 0007: Money and time conventions

Status: Accepted · 2026-10-21

## Context

PaymentChaos is global from the first commit. Amounts and timestamps are where payment tools most often go wrong: assuming two-decimal currencies, using floats, or formatting in the host's local timezone. Providers also disagree on timestamp units.

## Decision

**Money.** Every amount is an integer in the currency's minor units plus an ISO 4217 code. No floats for amounts, ever. A single shared currency-exponent table in `packages/core/src/money` covers:

- zero-decimal currencies (JPY, KRW, VND, CLP, ISK, and others),
- two-decimal currencies (the default),
- three-decimal currencies (BHD, KWD, OMR, JOD, TND).

Provider-specific amount quirks (for example how a provider encodes zero-decimal currencies in its API) live in that provider's adapter, never in core. Lifecycle packs take `currency` and `country` params; the test matrix includes at least USD, EUR, GBP, JPY, INR, BRL and BHD.

**Time.** Internal time is a monotonic logical clock plus UTC instants. Each provider adapter owns its wire timestamp format (Unix seconds, Unix milliseconds, or RFC 3339). Machine output (JSON, JUnit) and reports render UTC in ISO 8601. Planning/report code never formats with the host's local timezone.

## Consequences

- The currency table lives in `core` and is owned by the provider stream (per `AGENTS.md`); it is part of the frozen contract surface.
- Locale tests run the suite under `TZ=Pacific/Kiritimati`, `TZ=America/St_Johns` and `LANG=tr_TR.UTF-8`.
- Fixtures include non-ASCII customer data and multiple currencies (JPY, INR, BHD at minimum) to catch raw-body and exponent bugs.
