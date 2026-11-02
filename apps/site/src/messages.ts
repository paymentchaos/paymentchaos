export const siteMessages = {
  skipLink: "Skip to main content",
  homeLabel: "PaymentChaos home",
  primaryNav: "Primary navigation",
  navHowItWorks: "How it works",
  navDocs: "Docs",
  navEarlyAccess: "Early access",
  footerTagline: "PaymentChaos is an open-source prototype. No analytics. No trackers.",
  prototypeStatus: "Open-source prototype · early validation",
  validationIntro:
    "Try the source checkout today. PaymentChaos is not published to npm yet. Join the list for early-access updates and guided testing.",
  footerNav: "Footer navigation",
  footerDocs: "Documentation",
  footerPrivacy: "Privacy",
  waitlistUnavailable: "The waitlist is temporarily unavailable. Please check back soon.",
  ctaWaitlist: "Join the waitlist",
  ctaDocs: "Read the docs",
  ctaGithub: "View on GitHub",
  ctaTryDemo: "Try the demo",
  demoLabel: "PaymentChaos seed 1337 terminal output",
  demoRecording: "Download the 35-second terminal recording (.cast)",
  demoRecordingNote:
    "Captured CLI output, paced for readability. Replay with asciinema play demo.cast.",
  privacyContactHeading: "Who to contact",
  privacyContact:
    "The PaymentChaos project operates this waitlist. For privacy questions, access requests, or deletion requests, contact",
  privacyHostingHeading: "Website hosting",
  privacyHosting:
    "AWS Amplify hosts this website. AWS processes request information such as IP addresses, request paths, timestamps, and browser information to deliver and protect the site. Hosting access logs may contain these details; they are separate from the Loops mailing list and are not used by PaymentChaos for advertising or behavioral profiling.",
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
  success: "You’re on the early-access list. We’ll email you updates about guided testing.",
  successConfirm:
    "Almost done. Check your inbox and select the confirmation link to join the early-access list.",
  invalidEmail: "Enter a valid email address.",
  rateLimited: "Too many attempts were made. Wait a moment, then try again.",
  timeout: "The request took too long. Check your connection and try again.",
  network: "The waitlist could not be reached. Check your connection and try again.",
  invalidResponse: "The waitlist returned an unexpected response. Please try again later.",
  rejected: "The waitlist could not accept that email. Check it and try again.",
} as const;
