# Security Policy

## Supported versions

PaymentChaos has not published a release yet. After the first release, security fixes will target the latest minor version.

## Reporting a vulnerability

Do not open a public issue for a security problem. Report it privately through GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**.

Include the affected version or commit, reproduction steps and the impact you observed. We aim to acknowledge reports within 3 business days.

## Scope

PaymentChaos generates validly signed payment webhooks and runs user-configured commands. These areas are especially relevant:

- Secrets (webhook signing secrets) appearing in terminal output, logs or reports
- Bypass of the remote-target guard, which by default stops the tool from sending events to non-local hosts
- Command injection through scenario files, hooks or assertion commands
- Script injection in generated HTML reports
- Captured payloads leaving the developer's machine, or sanitization failing to remove personal data
- Supply-chain issues in published packages or the GitHub Action

## Design commitments

- No telemetry. The CLI only sends network requests to targets you configure.
- Captured webhook payloads are stored locally and are never uploaded.
- Generated events are always marked as test or sandbox events.
