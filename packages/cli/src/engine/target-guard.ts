import { PaymentChaosError } from "@paymentchaos/core";
import { messages } from "../messages.ts";

/**
 * Temporary target guard until `@paymentchaos/core` exports the canonical implementation.
 * INTEGRATION: delete this module and call core's guard from the real engine adapter.
 */

const PRIVATE_HOST_SUFFIXES = [".localhost", ".test", ".internal"] as const;

function isLoopback(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "[::1]") {
    return true;
  }
  if (h.startsWith("127.")) {
    return true;
  }
  if (h === "::1") {
    return true;
  }
  return false;
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  return false;
}

function hasPrivateSuffix(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return PRIVATE_HOST_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function hostAllowed(url: URL, allowRemoteTarget: string | undefined): boolean {
  const hostname = url.hostname;
  if (allowRemoteTarget !== undefined && hostname === allowRemoteTarget) {
    return true;
  }
  if (isLoopback(hostname) || isPrivateIpv4(hostname) || hasPrivateSuffix(hostname)) {
    return true;
  }
  return false;
}

export function assertTargetAllowed(targetUrl: string, allowRemoteTarget?: string): void {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new PaymentChaosError("CONFIG_INVALID", `Invalid target URL: ${targetUrl}`);
  }
  if (!hostAllowed(parsed, allowRemoteTarget)) {
    throw new PaymentChaosError("REMOTE_TARGET_BLOCKED", messages.remoteTargetBlocked, {
      details: { hostname: parsed.hostname },
    });
  }
}
