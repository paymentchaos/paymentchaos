import { describe, expect, it } from "vitest";
import { asSecretRef, PaymentChaosError } from "../contracts/index.ts";
import { REDACTED, redactSecrets, resolveSecret, secretValues } from "./secrets.ts";
import { assertTargetAllowed, isLocalHost } from "./target-guard.ts";

const errorCode = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    if (error instanceof PaymentChaosError) return error.code;
    throw error;
  }
  return "no error";
};

describe("remote-target guard", () => {
  it.each([
    "http://localhost:3000/webhooks",
    "http://LOCALHOST./hook",
    "http://127.0.0.1/",
    "http://127.1/",
    "http://2130706433/",
    "http://10.1.2.3/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.10:8080/",
    "http://169.254.1.1/",
    "http://[::1]:3000/",
    "http://[::ffff:127.0.0.1]/",
    "http://[fd12:3456::1]/",
    "http://[fe80::1]/",
    "https://api.localhost/",
    "http://app.test/",
    "http://billing.svc.internal/",
  ])("allows local target %s", (url) => {
    expect(() => assertTargetAllowed(url)).not.toThrow();
  });

  it.each([
    "https://api.example.com/webhooks",
    "http://8.8.8.8/",
    "http://172.32.0.1/",
    "http://192.169.0.1/",
    "http://0.0.0.0/",
    "http://[2001:db8::1]/",
    "http://[::ffff:8.8.8.8]/",
    "http://localhost.example.com/",
    "http://mytest/",
    "http://evil.com.test.example/",
  ])("blocks remote target %s with REMOTE_TARGET_BLOCKED (exit 2)", (url) => {
    expect(errorCode(() => assertTargetAllowed(url))).toBe("REMOTE_TARGET_BLOCKED");
    try {
      assertTargetAllowed(url);
    } catch (error) {
      expect((error as PaymentChaosError).exitCode).toBe(2);
      expect((error as Error).message).toContain("--allow-remote-target");
    }
  });

  it("allows a remote host only when named exactly", () => {
    const url = "https://staging.example.com/hooks";
    expect(() =>
      assertTargetAllowed(url, { allowRemoteTarget: "staging.example.com" }),
    ).not.toThrow();
    expect(() =>
      assertTargetAllowed(url, { allowRemoteTarget: ["STAGING.example.com."] }),
    ).not.toThrow();
    expect(errorCode(() => assertTargetAllowed(url, { allowRemoteTarget: "example.com" }))).toBe(
      "REMOTE_TARGET_BLOCKED",
    );
    expect(
      errorCode(() =>
        assertTargetAllowed("https://x.example.com/", { allowRemoteTarget: "example.com" }),
      ),
    ).toBe("REMOTE_TARGET_BLOCKED");
    expect(() =>
      assertTargetAllowed("http://[2001:db8::1]/", { allowRemoteTarget: "2001:DB8:0::1" }),
    ).not.toThrow();
    expect(() =>
      assertTargetAllowed("https://xn--bcher-kva.example/", {
        allowRemoteTarget: "bücher.example",
      }),
    ).not.toThrow();
  });

  it.each([
    "*.example.com",
    "https://example.com",
    "example.com:443",
    "user@example.com",
    "a/b",
    "",
  ])("rejects allow value %j as CONFIG_INVALID", (allow) => {
    expect(
      errorCode(() => assertTargetAllowed("http://localhost/", { allowRemoteTarget: allow })),
    ).toBe("CONFIG_INVALID");
  });

  it("rejects non-http protocols and unparsable URLs", () => {
    expect(errorCode(() => assertTargetAllowed("file:///etc/passwd"))).toBe("CONFIG_INVALID");
    expect(errorCode(() => assertTargetAllowed("not a url"))).toBe("CONFIG_INVALID");
  });

  it("never echoes userinfo or query strings in the error", () => {
    try {
      assertTargetAllowed("https://user:hunter2@api.example.com/hook?token=whsec_abc");
      expect.unreachable();
    } catch (error) {
      const text = `${(error as Error).message} ${JSON.stringify((error as PaymentChaosError).details)}`;
      expect(text).toContain("api.example.com");
      expect(text).not.toContain("hunter2");
      expect(text).not.toContain("whsec_abc");
    }
  });

  it("classifies bare hostnames", () => {
    expect(isLocalHost("[::1]")).toBe(true);
    expect(isLocalHost("example.org")).toBe(false);
  });
});

describe("secrets", () => {
  const env = { STRIPE_WEBHOOK_SECRET: "whsec_current", OLD: "whsec_old", EMPTY: "" };

  it("resolves a reference from the given environment", () => {
    expect(resolveSecret(asSecretRef("${STRIPE_WEBHOOK_SECRET}"), env)).toBe("whsec_current");
  });

  it("throws SECRET_MISSING naming the variable but no value", () => {
    for (const ref of ["${MISSING}", "${EMPTY}"]) {
      expect(errorCode(() => resolveSecret(asSecretRef(ref), env))).toBe("SECRET_MISSING");
    }
    expect(() => resolveSecret(asSecretRef("${MISSING}"), env)).toThrow(/MISSING/);
  });

  it("refuses literal secrets", () => {
    expect(errorCode(() => resolveSecret(asSecretRef("whsec_literal"), env))).toBe(
      "CONFIG_INVALID",
    );
  });

  it("collects resolvable values for redaction, skipping missing ones", () => {
    const keys = {
      current: asSecretRef("${STRIPE_WEBHOOK_SECRET}"),
      previous: [asSecretRef("${OLD}"), asSecretRef("${MISSING}")],
    };
    expect(secretValues(keys, env)).toEqual(["whsec_current", "whsec_old"]);
  });

  it("redacts every occurrence, longest secret first", () => {
    const text = "sig failed with whsec_current and whsec_current_v2 and whsec_old";
    expect(redactSecrets(text, ["whsec_current", "whsec_current_v2", "whsec_old", ""])).toBe(
      `sig failed with ${REDACTED} and ${REDACTED} and ${REDACTED}`,
    );
  });
});
