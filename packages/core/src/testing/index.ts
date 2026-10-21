/**
 * `@paymentchaos/core/testing`: test doubles for engine and CLI tests. Not for
 * production use; the fake provider encodes no real provider behaviour.
 */
export {
  createFakeProvider,
  DEFAULT_FAKE_FLOWS,
  FAKE_SIGNATURE_HEADER,
  type FakeProviderOptions,
} from "./fake-provider.ts";
