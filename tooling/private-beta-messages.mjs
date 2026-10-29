export const messages = {
  pnpmRequired: "Run this tool through pnpm pack:private or pnpm test:private-package.",
  usage: "Usage: pnpm pack:private [output-directory]",
  commandFailed: (command) => `Private package command failed: ${command}`,
  nativeAddon: "Private CLI archive unexpectedly contains a native add-on.",
  packaged: (path) => `Private archive ready: ${path}`,
  installed: (count) => `Offline private installation verified: ${count} sandbox cases passed.`,
};
