export function isTailscaleTailnetHost(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    return url.hostname.endsWith(".ts.net");
  } catch {
    return false;
  }
}

export function isTailscaleIpv4Host(value: string): boolean {
  const trimmed = value.trim();
  const host = trimmed.includes("://")
    ? (() => {
        try {
          return new URL(trimmed).hostname;
        } catch {
          return trimmed;
        }
      })()
    : trimmed.split(":")[0] ?? trimmed;
  return /^100\.(?:\d{1,3}\.){2}\d{1,3}$/u.test(host);
}

export function preferredRemoteEnvironmentUrlHint(value: string): string | null {
  if (isTailscaleTailnetHost(value)) {
    return null;
  }
  if (isTailscaleIpv4Host(value)) {
    return "Tailscale IPs can change. Prefer your MagicDNS URL (https://machine.tailnet.ts.net) when available.";
  }
  return null;
}
