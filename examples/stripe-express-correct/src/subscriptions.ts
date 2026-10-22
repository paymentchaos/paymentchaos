/**
 * Subscription ordering and access rules for the correct example. The README section
 * "Subscription ordering" explains them in prose.
 */

/**
 * Statuses that are final for one Stripe subscription id. Stripe documents `canceled` as "a
 * terminal state that can't be updated", and an `incomplete_expired` subscription is
 * reactivated only by creating a new subscription.
 * https://docs.stripe.com/billing/subscriptions/overview#subscription-statuses
 * https://docs.stripe.com/billing/subscriptions/overview#cancel-the-subscription
 */
export const TERMINAL_STATUSES: readonly string[] = ["canceled", "incomplete_expired"];

/**
 * Statuses that grant the customer access. Stripe: `active` is "in good standing", and
 * during `trialing` "you can safely provision your product for your customer".
 * https://docs.stripe.com/billing/subscriptions/overview#subscription-statuses
 */
export const ACCESS_STATUSES: readonly string[] = ["active", "trialing"];

export function grantsAccess(status: string): boolean {
  return ACCESS_STATUSES.includes(status);
}
