# @paymentchaos/site

Static Astro site for `paymentchaos.com`: a landing page and an early-access waitlist backed
by Loops. It loads no
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

### Build-time environment variables

All three are public. They are compiled into the static HTML, so never put a secret in them.

| Variable | Required | Effect |
| --- | --- | --- |
| `PUBLIC_LOOPS_FORM_ID` | For a working waitlist | The Loops form ID (the last path segment of the form endpoint). When it is unset, the page shows "The waitlist is temporarily unavailable" and ships no form script. |
| `PUBLIC_LOOPS_DOUBLE_OPT_IN` | No | Set to `true` when double opt-in is enabled in Loops. The success message then tells the visitor to confirm from their inbox. The Loops response does not report this. |
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
