import { registerScenarioRunner } from "../src/scenario-runner.js";
import { createStubStripeSubscriptionRenewalRunner } from "../src/stub-stripe-subscription-renewal.js";

registerScenarioRunner(createStubStripeSubscriptionRenewalRunner);
