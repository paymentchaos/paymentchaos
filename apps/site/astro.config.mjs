import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  site: "https://paymentchaos.com",
  markdown: {
    syntaxHighlight: false,
  },
  security: {
    // Astro hashes the scripts and styles it emits and writes the policy as a <meta> tag.
    // https://docs.astro.build/en/reference/configuration-reference/#securitycsp
    csp: {
      directives: [
        "default-src 'self'",
        // The waitlist form posts directly to Loops from the browser.
        "connect-src 'self' https://app.loops.so",
        "img-src 'self'",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
    },
  },
});
