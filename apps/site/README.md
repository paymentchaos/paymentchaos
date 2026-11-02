# @paymentchaos/site

Static Astro site for `paymentchaos.com`: a landing page, a privacy notice, an early-access
waitlist backed by Loops, and Starlight documentation mounted at `/docs`. It loads no
analytics, fonts or scripts from third parties. The only cross-origin request is the
waitlist `POST` to Loops.

## Local development

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @paymentchaos/site dev      # http://localhost:4321
pnpm --filter @paymentchaos/site build    # astro check + static build into apps/site/dist
pnpm --filter @paymentchaos/site test     # waitlist state machine (also part of root `pnpm test`)
```

Astro applies its Content-Security-Policy only to built pages, not in `dev`
([Astro docs](https://docs.astro.build/en/reference/configuration-reference/#securitycsp)).
Check CSP with `pnpm --filter @paymentchaos/site exec astro preview` after a build.

Astro hashes the scripts and styles it bundles, but not Starlight's inline theme and sidebar
scripts or its `style="…"` attributes. Those hashes are listed in `astro.config.mjs`. After
`astro build`, `scripts/check-csp.ts` recomputes every inline hash in `dist/` and fails the
build if a page needs one that is missing, printing the hash to add. It also fails if a page
loads a third-party subresource. Expect it to fire after a Starlight upgrade or new Markdown
features, such as a right-aligned table column.

### Build-time environment variables

All three are public. They are compiled into the static HTML, so never put a secret in them.

| Variable | Required | Effect |
| --- | --- | --- |
| `PUBLIC_LOOPS_FORM_ID` | For a working waitlist | The Loops form ID (the last path segment of the form endpoint). When it is unset, the page shows "The waitlist is temporarily unavailable" and ships no form script. |
| `PUBLIC_LOOPS_DOUBLE_OPT_IN` | No | Set to `true` when double opt-in is enabled in Loops. The success message then tells the visitor to confirm from their inbox. The Loops response does not report this. |
| `PUBLIC_GITHUB_URL` | No | Overrides the repository link. Defaults to `https://github.com/paymentchaos/paymentchaos` for the public validation launch. |

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

## Waitlist behavior (Loops)

Verified against the [Loops custom form docs](https://loops.so/docs/forms/custom-form):

- Request: `POST https://app.loops.so/api/newsletter-form/{formId}` with
  `Content-Type: application/x-www-form-urlencoded` and the field `email`.
- Success: HTTP 200 with `{ "success": true }`. Failure: HTTP 400 or 500 with
  `{ "success": false, "message": "…" }`.
- Rate limit: "a low number of requests per minute from each IP address". Requests over the
  limit get HTTP 429. Loops does not publish the number or a retry interval.
- Double opt-in "is currently only enabled on Form endpoints". New contacts stay "Pending" until
  they click the confirmation link ([double opt-in](https://loops.so/docs/contacts/double-opt-in)).
  The form response is the same either way.

`src/lib/waitlist.ts` shows success only for a 2xx response whose JSON body contains
`success: true`. Each of these failure cases has its own message: invalid email (no request is
sent), network error, an 8-second timeout through `AbortController`, 429, a non-JSON or
unparseable body, and `success: false` (Loops' message is shown when it provides one). The button
is disabled while a request is pending, and the form locks after success. Without JavaScript the
form stays hidden and a `<noscript>` message explains why, so a visitor never lands on raw JSON.

## Owner setup: Loops

Do this before setting `PUBLIC_LOOPS_FORM_ID` in Amplify.

1. Sign in at [app.loops.so](https://app.loops.so).
2. **Create the form.** Open **Forms** in the left sidebar and create a form, for example
   "PaymentChaos early access". Open its **Settings** tab and copy the **Form Endpoint** URL. The
   form ID is the final segment of
   `https://app.loops.so/api/newsletter-form/<form-id>`. Copy only that segment.
3. **Turn on double opt-in.** Go to **Settings → Sending** and scroll to **Double opt-in**. Turn
   it on. Loops creates a confirmation email under **Transactional**. Open it, choose
   **Edit Draft**, keep the `optInUrl` confirmation link, adjust the copy, and **Publish** it.
4. **Turn off tracking.** Under **Settings → Sending**, turn off open tracking and link
   tracking for all emails. Loops enables both by default for marketing emails, and the privacy
   page promises no trackers. In each campaign editor, also check that per-link tracking is off.
   Transactional emails, such as the opt-in confirmation, are never tracked
   ([links and tracking](https://loops.so/docs/creating-emails/editor/links)).
5. **Make deletion requests reachable.** The privacy page tells subscribers to reply to any
   waitlist email to ask for deletion. Set a monitored reply-to address on waitlist emails. To
   delete someone, open **Audience**, click the `•••` menu on the contact and choose **Delete**
   ([deleting contacts](https://loops.so/docs/contacts/delete-contacts)). The unsubscribe link
   that Loops adds to every campaign footer opens its preference center.
6. **Test from a deployed URL.** Loops documents browser `fetch` submissions but publishes no
   CORS policy for the form endpoint. After the first deploy, try a valid address, an
   invalid one and a repeat signup on the preview URL and on `paymentchaos.com`. Confirm the new
   contact shows as Pending and becomes subscribed after you click the confirmation link.

## Owner setup: AWS Amplify Hosting

The repository root holds `amplify.yml` (build) and `customHttp.yml` (security headers). Both
use Amplify's monorepo format with `appRoot: apps/site`.

1. **Move or create the repository under the `paymentchaos` GitHub organization** before you
   connect it. An Amplify app is bound to one repository, so connecting after the move avoids
   reconnecting later.
2. **Create the app.** In the [Amplify console](https://console.aws.amazon.com/amplify/), choose
   **Create new app → GitHub → Next**. When GitHub asks where to install the **AWS Amplify**
   GitHub App, choose the `paymentchaos` organization. Pick **Only select repositories →
   paymentchaos**, then **Install & Authorize**. An organization owner should do this step.
   When another member tries, GitHub sends the owner an installation request instead of
   installing the app
   ([GitHub docs](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party)).
3. **Choose the repository and branch.** Select `paymentchaos` and the `main` branch. Tick
   **My app is a monorepo** and enter `apps/site` as the root directory. Amplify then sets
   `AMPLIFY_MONOREPO_APP_ROOT=apps/site`, which must match `appRoot` in `amplify.yml`
   ([monorepo docs](https://docs.aws.amazon.com/amplify/latest/userguide/monorepo-configuration.html)).
4. **Build settings.** Amplify detects the repository's `amplify.yml`. Leave it as is. It
   installs Node 24.22.0 through `nvm`, enables Corepack for the `packageManager` pnpm, runs
   `pnpm install --frozen-lockfile`, and builds with `ASTRO_TELEMETRY_DISABLED=1`. Under
   **Advanced settings**, add the environment variables from the table above. Choose **Next →
   Save and deploy**.
5. **Environment variables later.** Open **Hosting → Environment variables → Manage
   variables**. To give previews a separate Loops form, use **Actions → Add variable override**
   for a branch. Redeploy after every change, because the values are compiled into the build
   ([environment variables](https://docs.aws.amazon.com/amplify/latest/userguide/setting-env-vars.html)).
6. **PR previews.** Open **Hosting → Previews**. Install the GitHub App if prompted, select
   `main`, choose **Edit settings**, turn on **Pull request previews** and **Confirm**. Amplify
   deletes a preview when its PR closes. Once the repository is public, previews stay available
   only while the app has no IAM service role. This static app needs none, so do not attach
   one ([PR previews](https://docs.aws.amazon.com/amplify/latest/userguide/pr-previews.html)).
7. **Custom domain.** Open **Hosting → Custom domains → Add domain** and enter
   `paymentchaos.com`.
   - If the domain's DNS is in Route 53, Amplify can create the records for you.
   - With another DNS provider, choose **Manual configuration** and keep the Amplify-managed
     certificate. Choose **Add domain**, then **Actions → View DNS records**. Add the certificate
     validation CNAME immediately, because a late record can leave the domain stuck in pending
     verification. Then add the `www` CNAME to the shown `*.cloudfront.net` target, and an
     ANAME/ALIAS for the apex if your provider supports it.
   - Amplify redirects the apex to `www` by default. The canonical URLs in the built pages use
     `https://paymentchaos.com`, so decide which host is primary before launch.
   - Verification can take up to 48 hours
     ([third-party DNS](https://docs.aws.amazon.com/amplify/latest/userguide/to-add-a-custom-domain-managed-by-a-third-party-dns-provider.html)).
8. **Headers.** `customHttp.yml` overrides headers set in the console. Redeploy after changing
   it ([custom headers](https://docs.aws.amazon.com/amplify/latest/userguide/custom-headers.html)).
   Then check that the live response carries `Content-Security-Policy`,
   `Strict-Transport-Security`, `Referrer-Policy`, `X-Content-Type-Options`,
   `Permissions-Policy` and `X-Frame-Options`:

   ```sh
   curl -sI https://paymentchaos.com/ | grep -iE 'content-security|strict-transport|referrer|x-content|permissions|x-frame'
   ```

9. **Custom 404 page.** Open **Hosting → Rewrites and redirects → Manage redirects** and add
   a rule with source `/<*>`, target `/404.html` and the **not found (404)** type (`"status":
   "404"` in the JSON editor). Amplify documents this rule for paths that cannot be found, so
   real pages are unaffected
   ([redirect examples](https://docs.aws.amazon.com/amplify/latest/userguide/redirect-rewrite-examples.html)).
10. **Before announcing.** On a PR preview and on the custom domain, check keyboard-only use,
   reduced motion, a 390 px wide viewport, the waitlist failure messages, and the browser console
   for CSP violations.
