export const messages = {
  displayName: "Generic HMAC",
  flow: "Developer-supplied events",
  unknownFlow: "Unknown generic HMAC flow; choose user-event.",
  config: (issues: string) =>
    `Invalid generic HMAC params: ${issues}. Set params.events to inline {type, body} entries and params.format to a preset or signing format; see provider-generic/README.md.`,
  template: "use {body}, optionally {id} and {timestamp}, with no other braces",
  header: "use an HTTP token header name distinct from metadata and transport headers",
  timestamp:
    "Generic HMAC timestamp is invalid; supply nonnegative whole UTC epoch milliseconds within the JavaScript Date range.",
  secret:
    "Standard Webhooks key is invalid; set the referenced environment variable to whsec_ followed by canonical base64 encoding of 24–64 secret bytes.",
  mismatch:
    "Generic HMAC signature is missing or invalid; preserve raw body and metadata headers and verify the configured format and secret.",
  stale:
    "Standard Webhooks timestamp is outside the 300-second tolerance; use a fresh delivery timestamp.",
};
