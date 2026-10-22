import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

const githubUrl = process.env.PUBLIC_GITHUB_URL?.trim();

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
        // Starlight draws its table-of-contents and <details> icons with inline data: SVG masks.
        "img-src 'self' data:",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
      // Starlight's inline theme scripts and its style attributes are not hashed by Astro.
      // scripts/check-csp.ts fails the build when the built pages need a hash missing here.
      scriptDirective: {
        hashes: [
          // Theme provider and theme picker initialisation.
          "sha256-VWo5Wp4aqSj6nSgMpeAp9cKieaoIfwFUAunAVugI5gA=",
          "sha256-GkZBRnvSuhtx/cvzvukVkX2JJZW+DdPlVr7BX8Tefqo=",
          // Sidebar scroll-position and open-group restoration.
          "sha256-7eCV4jtsr4t4knb3c4FCRPeu7GGZeOUGE3XvWix0XOQ=",
          "sha256-wX2yOADeV+NMngflD5uYi3vl50SHC4sfM1EmylVjlX4=",
        ],
      },
      styleDirective: {
        resources: [{ resource: "'unsafe-hashes'", kind: "attribute" }],
        hashes: [
          // style="--sl-select-width: 6.25em"
          { hash: "sha256-EOZ7IwL6g2pUr/BQpb9n6VhOtvHLk6UMtjwgNikSHTw=", kind: "attribute" },
          // style="--sl-icon-size: 1em;"
          { hash: "sha256-VYLa8fO3Sg6dJRXXw7VIjyTkcNLC4IuPCz1UPV1OKy0=", kind: "attribute" },
          // style="--sl-icon-size: 1.5rem;"
          { hash: "sha256-r2WEacw89sPmp/OD8a8qTrigv6kSvYZXLpAnutU3xjQ=", kind: "attribute" },
          // style="--sl-icon-size: 1.25rem;"
          { hash: "sha256-4nwmP7y2Oqil2yoHYBvRn7OImAddhzMs7BiQ3EXY2ls=", kind: "attribute" },
          // style="--sl-icon-size: 1rem;"
          { hash: "sha256-wrvMNywJ/dvSTFeuRqdBZPkNpA9KJjNVehBzjKFXP5A=", kind: "attribute" },
          // Table-of-contents nesting: style="--depth: 0;" and style="--depth: 1;"
          { hash: "sha256-N0U7UbX70ebuNVEQiGcI+KTCoqytKKf6vbasn4H+n3A=", kind: "attribute" },
          { hash: "sha256-+o0Ukw+pibd6OGgynNyobYZNy77EwLqaKT/4mYFmQeA=", kind: "attribute" },
          // Right-aligned Markdown table cells: style="text-align: right"
          { hash: "sha256-i0JPB0qmRu5AViJTxOIzqXnfGoiWFw+oNAm4uJd7ZQk=", kind: "attribute" },
        ],
      },
    },
  },
  integrations: [
    starlight({
      title: "PaymentChaos",
      description: "Documentation for deterministic payment webhook failure testing.",
      customCss: ["./src/styles/docs.css"],
      expressiveCode: false,
      pagefind: false,
      social: githubUrl ? [{ icon: "github", label: "GitHub", href: githubUrl }] : [],
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Overview", slug: "docs" },
            { label: "Early-access quickstart", slug: "docs/quickstart" },
            { label: "Project configuration", slug: "docs/configuration" },
          ],
        },
        {
          label: "Concepts",
          items: [
            { label: "Scenarios and chaos", slug: "docs/scenarios" },
            { label: "Application-state assertions", slug: "docs/assertions" },
            { label: "Determinism and reproduction", slug: "docs/determinism" },
            { label: "Exit codes and safety", slug: "docs/safety" },
          ],
        },
      ],
      lastUpdated: false,
      // src/pages/404.astro serves the whole site, so Starlight must not claim /404.
      disable404Route: true,
    }),
  ],
});
