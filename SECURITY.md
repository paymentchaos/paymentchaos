# Security Policy

## Supported versions

PaymentChaos is a development prototype with no npm release yet. Report problems against
the latest `main` commit and include its SHA. After the first release, security fixes will
target the latest minor version.

## Reporting a vulnerability

Do not open a public issue for a security problem. Use GitHub's private vulnerability
reporting: open the repository's **Security** tab and choose **Report a vulnerability**.
If that option is unavailable, email [hello@paymentchaos.com](mailto:hello@paymentchaos.com)
with the subject "PaymentChaos security report". Do not include production credentials
or real customer payloads; use a synthetic reproduction.

Include the affected version or commit, reproduction steps and the impact you observed. We aim to acknowledge reports within 3 business days.

## Scope

PaymentChaos generates validly signed payment webhooks and runs user-configured commands. These areas are especially relevant:

- Secrets (webhook signing secrets) appearing in terminal, JSON or JUnit output, logs or reports
- Bypass of the remote-target guard, which by default stops the tool from sending events to non-local hosts
- Command injection through scenario files, hooks or assertion commands
- Incorrect escaping or misleading results in terminal, JSON or JUnit reports
- Generated payloads or signing secrets being sent to an unintended destination
- Supply-chain issues in source builds or locally generated offline archives

HTML reports, webhook capture/sanitization, and a reusable GitHub Action are planned,
not implemented. The repository's CI workflow runs the included local examples; it is
not a published action for third-party projects.

## Design commitments

- No telemetry. The webhook engine sends requests only to targets you configure.
- Configured hooks and assertion commands execute local programs. Only run scenario files
  and project configurations you trust; those programs can access files and the network
  using your account's permissions.
- Reports and generated offline archives are written locally. The example CI workflow
  explicitly uploads its synthetic demo reports as GitHub Actions artifacts.
- Generated events are always marked as test or sandbox events.
