export const siteMessages = {
  productName: "PaymentChaos",
  skipLink: "Skip to main content",
  homeLabel: "PaymentChaos home",
  primaryNav: "Primary navigation",
  navHowItWorks: "How it works",
  navDocs: "Docs",
  navEarlyAccess: "Early access",
  footerTagline: "PaymentChaos is a private prototype. No analytics. No trackers.",
  footerNav: "Footer navigation",
  footerDocs: "Documentation",
  footerPrivacy: "Privacy",
  waitlistUnavailable: "The waitlist is temporarily unavailable. Please check back soon.",
  ctaWaitlist: "Join the waitlist",
  ctaDocs: "Read the current docs",
  ctaGithub: "View on GitHub",
  demoLabel: "PaymentChaos seed 1337 terminal output",
} as const;

export const waitlistMessages = {
  label: "Work or personal email",
  consent:
    "By joining, you consent to receive PaymentChaos early-access updates by email. Loops stores your email for this purpose. You can unsubscribe at any time. See our",
  privacyLink: "privacy notice",
  noscript:
    "Joining the waitlist needs JavaScript, which is turned off in this browser. Turn it on and reload this page to join.",
  idle: "",
  button: "Join the waitlist",
  buttonPending: "Joining…",
  pending: "Joining the waitlist…",
  success: "You’re on the early-access list. We’ll email you when guided access opens.",
  successConfirm:
    "Almost done. Check your inbox and select the confirmation link to join the early-access list.",
  invalidEmail: "Enter a valid email address.",
  rateLimited: "Too many attempts were made. Wait a moment, then try again.",
  timeout: "The request took too long. Check your connection and try again.",
  network: "The waitlist could not be reached. Check your connection and try again.",
  invalidResponse: "The waitlist returned an unexpected response. Please try again later.",
  rejected: "The waitlist could not accept that email. Check it and try again.",
} as const;
