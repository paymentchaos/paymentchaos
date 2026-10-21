import { BlockList, isIP } from "node:net";
import { domainToASCII } from "node:url";
import { PaymentChaosError } from "../contracts/index.ts";
import { messages } from "../messages.ts";

/**
 * Remote-target guard (ADR 0006). PaymentChaos sends validly signed payment events, so
 * by default it only talks to loopback, private-network and reserved local hostnames.
 * Anything else needs an explicit `allowRemoteTarget` host. Enforced in core, before
 * any send, so every entry point (CLI, library, Action) is covered.
 */

const LOCAL_ADDRESSES = new BlockList();
LOCAL_ADDRESSES.addSubnet("127.0.0.0", 8, "ipv4"); // loopback, RFC 1122 §3.2.1.3
LOCAL_ADDRESSES.addSubnet("10.0.0.0", 8, "ipv4"); // private, RFC 1918
LOCAL_ADDRESSES.addSubnet("172.16.0.0", 12, "ipv4"); // private, RFC 1918
LOCAL_ADDRESSES.addSubnet("192.168.0.0", 16, "ipv4"); // private, RFC 1918
LOCAL_ADDRESSES.addSubnet("169.254.0.0", 16, "ipv4"); // link-local, RFC 3927
LOCAL_ADDRESSES.addAddress("::1", "ipv6"); // loopback, RFC 4291
LOCAL_ADDRESSES.addSubnet("fc00::", 7, "ipv6"); // unique local, RFC 4193
LOCAL_ADDRESSES.addSubnet("fe80::", 10, "ipv6"); // link-local, RFC 4291

/**
 * Reserved names that can never be public internet hosts: `.localhost` and `.test`
 * (RFC 6761 §6.3, §6.2) and `.internal` (ICANN board resolution 2024.07.29.06).
 */
const LOCAL_SUFFIXES = [".localhost", ".test", ".internal"] as const;

/** A concrete DNS name: no wildcard, scheme, port, path or userinfo. */
const HOSTNAME_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

export interface TargetGuardOptions {
  /**
   * Hosts the user explicitly allowed with `--allow-remote-target <host>`. Exact,
   * case-insensitive hostname match; no wildcards, no schemes, no ports.
   */
  readonly allowRemoteTarget?: string | readonly string[];
}

/** Lowercase, drop IPv6 brackets and one trailing root dot. */
function normalizeHost(hostname: string): string {
  let host = hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

/** True when `hostname` (as in `URL.hostname`) is loopback, private or reserved-local. */
export function isLocalHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  const family = isIP(host);
  if (family === 4) return LOCAL_ADDRESSES.check(host, "ipv4");
  if (family === 6) return LOCAL_ADDRESSES.check(host, "ipv6");
  return host === "localhost" || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function allowedHosts(option: TargetGuardOptions["allowRemoteTarget"]): Set<string> {
  const list = option === undefined ? [] : typeof option === "string" ? [option] : option;
  const hosts = new Set<string>();
  for (const raw of list) {
    const host = normalizeHost(raw.trim());
    const family = isIP(host);
    // Canonicalize IPv6 the way URL.hostname does, so "2001:DB8:0::1" matches "2001:db8::1".
    const canonical =
      family === 6
        ? normalizeHost(new URL(`http://[${host}]/`).hostname)
        : family === 4
          ? host
          : domainToASCII(host);
    // Check the raw text too: domainToASCII silently truncates at "/" and other delimiters.
    if (family === 0 && (/[^\p{L}\p{M}\p{N}.-]/u.test(host) || !HOSTNAME_PATTERN.test(canonical))) {
      throw new PaymentChaosError("CONFIG_INVALID", messages.allowRemoteTargetInvalid(raw));
    }
    hosts.add(canonical);
  }
  return hosts;
}

/**
 * Throw unless `url` is a local target or its host was explicitly allowed. Only the host
 * appears in errors: URLs can carry credentials or tokens in userinfo and query strings.
 */
export function assertTargetAllowed(url: string | URL, options: TargetGuardOptions = {}): URL {
  let parsed: URL;
  try {
    parsed = typeof url === "string" ? new URL(url) : url;
  } catch (cause) {
    throw new PaymentChaosError("CONFIG_INVALID", messages.targetUrlInvalid(), { cause });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PaymentChaosError("CONFIG_INVALID", messages.targetProtocolInvalid(parsed.protocol));
  }
  const allowed = allowedHosts(options.allowRemoteTarget);
  const host = normalizeHost(parsed.hostname);
  if (!isLocalHost(host) && !allowed.has(host)) {
    throw new PaymentChaosError("REMOTE_TARGET_BLOCKED", messages.remoteTargetBlocked(host), {
      details: { host },
    });
  }
  return parsed;
}
