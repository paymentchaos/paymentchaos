export const captureMessages = {
  failed: (code: number) => `Golden demo exited with code ${code}; transcript was not replaced.`,
  unexpected: "Golden demo did not show the expected naive failure and corrected-app pass.",
  title: "PaymentChaos — captured CLI output, paced for readability",
  finished: (path: string) => `Captured real seed-1337 demo output in ${path} and public/demo.cast`,
} as const;
