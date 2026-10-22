# @paymentchaos/site

Static Astro site for `paymentchaos.com`. It loads no analytics, fonts or scripts from third
parties.

## Local development

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @paymentchaos/site dev      # http://localhost:4321
pnpm --filter @paymentchaos/site build    # astro check + static build into apps/site/dist
```

Astro applies its Content-Security-Policy only to built pages, not in `dev`
([Astro docs](https://docs.astro.build/en/reference/configuration-reference/#securitycsp)).
Check CSP with `pnpm --filter @paymentchaos/site exec astro preview` after a build.

### Build-time environment variables

These are public. They are compiled into the static HTML, so never put a secret in them.

| Variable | Required | Effect |
| --- | --- | --- |
| `PUBLIC_GITHUB_URL` | No | The public repository URL. The GitHub links are only rendered when this is set. Leave it unset while the repository is private. |

### Terminal demo transcript

`src/data/demo.txt` is real output from `pnpm --filter @paymentchaos/golden-e2e demo`
(seed 1337). Recapture it after the CLI output changes:

```sh
pnpm build
pnpm --filter @paymentchaos/site demo:capture
```

The capture script builds nothing itself. It runs the golden demo, refuses to overwrite the
transcript if the demo fails, and replaces absolute paths with `<repo>`. Event IDs and latencies
change on every run.
