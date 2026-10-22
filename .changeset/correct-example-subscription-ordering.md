---
"@paymentchaos/example-stripe-express-correct": patch
"@paymentchaos/golden-e2e": patch
---

Store subscription state per Stripe subscription id in the correct Stripe example and derive the customer's access from any `active` or `trialing` subscription. Strictly older snapshots are rejected, `canceled` and `incomplete_expired` never revert, and the later delivery wins a same-second tie. The README documents these rules and when production code should re-fetch from the Stripe API. The `/__test__/state` endpoint now returns `subscriptions` and `hasAccess`.
