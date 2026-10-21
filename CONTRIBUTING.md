# Contributing to PaymentChaos

Read [`AGENTS.md`](AGENTS.md) first. It is the engineering contract for everyone who works on this repository.

## Setup

```bash
corepack enable pnpm        # pnpm version comes from package.json#packageManager
pnpm install
git config core.hooksPath .githooks
```

Node.js and pnpm versions are listed in the [README](README.md#required-versions).

## Workflow

- Never push directly to `main`. Create a branch, open a pull request, and wait for review. The `.githooks/pre-push` hook blocks accidental pushes to `main`.
- Keep pull requests small and focused on one logical change.
- Add a changeset (`pnpm changeset`) for every user-visible change to a published package.
- Before requesting review, run:

  ```bash
  pnpm typecheck && pnpm lint && pnpm test
  ```

- Never commit secrets, real customer data or unsanitized captured webhooks. Fixtures must be synthesized or sanitized.

## Reviews

Every pull request needs at least one independent review and passing checks before it merges. Changes to public contracts (`packages/core/src/contracts/**`), security-sensitive code and anything destructive also need maintainer approval.
