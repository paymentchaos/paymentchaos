export const landingMessages = {
  title: "PaymentChaos — test beyond the payment happy path",
  description:
    "Find duplicate entitlements, stale subscriptions, and webhook races with deterministic payment webhook testing and application-state assertions.",
  eyebrow: "Local-first webhook testing · private prototype",
  heroTitle: "Break your payment integration",
  heroRest: "before production does.",
  heroDescription:
    "Send correctly signed webhooks through duplicates, reordered events, delays, and concurrent retries. Then check what matters: your application’s business state.",
  ctaDocs: "Explore the docs",
  ctaDemo: "See a real run",
  sourceNote: "Early access from source. Not published to npm yet.",
  waitlistTitle: "Build more reliable payment flows.",
  waitlistDescription:
    "Join the early-access list to help validate PaymentChaos with your integration. We’ll email you when guided access opens.",
  providersLabel: "Current provider adapters",
  providers: ["Stripe", "Razorpay", "Generic HMAC"],
  portability: "Any backend language. macOS, Linux, Windows.",
  failuresLabel: "Where payment integrations break",
  failuresTitle: "A successful response can hide a broken state.",
  failuresDescription:
    "A webhook can return 200 while your app grants twice, revokes the wrong subscription, or loses a race.",
  failures: [
    {
      label: "01 / Duplicates",
      signal: "1 event → 2 deliveries → 2 grants",
      title: "One renewal. Two entitlements.",
      description:
        "A retried event is processed again. Both requests succeed, but a customer receives duplicate entitlements because the handler is not idempotent.",
    },
    {
      label: "02 / Event ordering",
      signal: "renewal → older cancellation → revoked",
      title: "An old cancellation wins.",
      description:
        "A delayed cancellation arrives after a newer renewal. Trusting arrival order revokes a subscription that should still be active.",
    },
    {
      label: "03 / Concurrency",
      signal: "check ∥ check → insert ∥ insert",
      title: "Two retries pass the same guard.",
      description:
        "Concurrent deliveries both pass a check-then-insert guard before either writes. A duplicate slips through when processing is not atomic.",
    },
  ],
  demoLabel: "A real result, not a mock dashboard",
  demoTitle: "Same scenario. A different outcome.",
  demoDescription:
    "The real CLI runs the Stripe renewal scenario against both included example apps, using seed 1337. Every delivery is accepted. Only one app keeps its state correct.",
  naiveLabel: "✕ Naive handler · exit 1",
  naiveResult: "5 entitlements. Expected 1.",
  naiveDetail: "Duplicate renewal ledger entries reveal the same idempotency bug.",
  correctLabel: "✓ Correct handler · exit 0",
  correctResult: "1 entitlement. 1 ledger entry.",
  correctDetail: "Application-state checks pass after the same delivery scenario.",
  transcriptToggle: "Inspect the full CLI transcript",
  transcriptNote: "Recorded CLI output. Event IDs, ports, and latencies vary between runs.",
  worksLabel: "From event to evidence",
  worksTitle: "Three steps to a reproducible failure.",
  steps: [
    {
      title: "Choose the lifecycle",
      description:
        "Start with a built-in provider scenario, or describe your own versioned scenario in YAML.",
    },
    {
      title: "Apply controlled chaos",
      description:
        "Duplicate, reorder, delay, or release deliveries concurrently. A seed reproduces the delivery plan and its hash.",
    },
    {
      title: "Check your business state",
      description:
        "Run your own verification command against entitlements, subscriptions, or ledgers. Use the verdict in local scripts and CI.",
    },
  ],
  differenceLabel: "Built for correctness",
  differenceTitle: "Go from inspecting traffic to testing invariants.",
  differenceDescription:
    "Capture-and-replay tools help inspect and resend HTTP traffic. PaymentChaos complements that workflow with controlled failure schedules and checks on the state your app owns.",
  differences: [
    {
      title: "Provider-aware deliveries",
      description: "Provider-shaped events, exact body bytes, and valid test signatures.",
    },
    {
      title: "Repeatable delivery plans",
      description: "A recorded seed and plan hash make failures easier to investigate.",
    },
    {
      title: "Your data. Your assertions.",
      description: "Bring a verification command for your backend, database, and business rules.",
    },
  ],
  preview: {
    title: "Delivery plan",
    seed: "seed 1337",
    event: "invoice.paid",
    attempts: ["attempt 1", "attempt 2", "attempts 3–5"],
    accepted: "200 OK",
    result: "✕ Business-state assertion failed",
    assertion: "renewal_entitlements",
    expected: "expected 1 → observed 5",
    caption: "Illustration based on the seed 1337 demo below.",
  },
} as const;
