// Interface strings for the docs components. Page prose stays in the MDX files.
export const docsMessages = {
  quickstartEyebrow: "Start here",
  quickstartAction: "Open the quickstart",
  pathKind: {
    guide: "Guide",
    concept: "Concept",
    reference: "Reference",
  },
} as const;

export type DocsPathKind = keyof typeof docsMessages.pathKind;
