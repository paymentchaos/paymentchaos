import { messages } from "./messages.js";

export interface VerifyArgs {
  readonly customerId: string;
  readonly baseUrl: string;
  readonly expectedActiveSubscriptionId?: string;
}

export function parseVerifyArgs(argv: readonly string[]): VerifyArgs {
  let baseUrl: string | undefined;
  const positional: string[] = [];
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base-url") {
      baseUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg !== undefined && !arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  const fromEnv = process.env.PAYMENTCHAOS_ID_CUSTOMER ?? process.env.CUSTOMER_ID;
  const customerId = positional[0] ?? fromEnv;
  if (!customerId || customerId.length === 0) {
    throw new Error(messages.verifyMissingCustomer);
  }
  if (!baseUrl || baseUrl.length === 0) {
    throw new Error(messages.verifyMissingBaseUrl);
  }

  const expectedActiveSubscriptionId =
    process.env.PAYMENTCHAOS_ID_SUBSCRIPTION ?? process.env.PAYMENTCHAOS_ID_SUBSCRIPTION_1;

  return {
    customerId,
    baseUrl,
    ...(expectedActiveSubscriptionId !== undefined && expectedActiveSubscriptionId.length > 0
      ? { expectedActiveSubscriptionId }
      : {}),
  };
}
