import type { AdvertisedEndpoint } from "@t3tools/contracts";
import type { DesktopBridge, DesktopWslState } from "@t3tools/contracts";

type WslEnableBridge = Pick<DesktopBridge, "setWslBackendEnabled" | "setWslDistro" | "setWslOnly">;

export async function applyWslEnableSelection(input: {
  readonly bridge: WslEnableBridge;
  readonly mode: "both" | "wsl-only";
  readonly nextDistro: string | null;
  readonly persistedDistro: string | null;
}): Promise<DesktopWslState> {
  const { bridge, mode, nextDistro, persistedDistro } = input;

  // Stage every preference before enabling. The desktop only relaunches for
  // mode/distro changes while WSL is active, so the final enable observes the
  // complete selection and is the only call that may relaunch.
  await bridge.setWslOnly(mode === "wsl-only");
  if (persistedDistro !== nextDistro) {
    await bridge.setWslDistro(nextDistro);
  }
  return await bridge.setWslBackendEnabled(true);
}

export function isTailscaleHttpsEndpoint(endpoint: AdvertisedEndpoint): boolean {
  return endpoint.id.startsWith("tailscale-magicdns:");
}

export function selectPairingEndpoint(
  endpoints: ReadonlyArray<AdvertisedEndpoint>,
  defaultEndpointKey?: string | null,
): AdvertisedEndpoint | null {
  const availableEndpoints = endpoints.filter((endpoint) => endpoint.status !== "unavailable");
  if (defaultEndpointKey) {
    const selectedEndpoint = availableEndpoints.find(
      (endpoint) => endpointDefaultPreferenceKey(endpoint) === defaultEndpointKey,
    );
    if (selectedEndpoint) {
      return selectedEndpoint;
    }
  }
  return (
    availableEndpoints.find(isTailscaleHttpsEndpoint) ??
    availableEndpoints.find((endpoint) => endpoint.compatibility.hostedHttpsApp === "compatible") ??
    availableEndpoints.find((endpoint) => endpoint.isDefault) ??
    availableEndpoints.find((endpoint) => endpoint.reachability !== "loopback") ??
    null
  );
}

export function endpointDefaultPreferenceKey(endpoint: AdvertisedEndpoint): string {
  if (endpoint.id.startsWith("desktop-loopback:")) {
    return "desktop-core:loopback:http";
  }
  if (endpoint.id.startsWith("desktop-lan:")) {
    return "desktop-core:lan:http";
  }
  if (endpoint.id.startsWith("tailscale-ip:")) {
    return "tailscale:ip:http";
  }
  if (isTailscaleHttpsEndpoint(endpoint)) {
    return "tailscale:magicdns:https";
  }

  let scheme = "unknown";
  try {
    scheme = new URL(endpoint.httpBaseUrl).protocol.replace(/:$/u, "");
  } catch {
    // Keep the stored preference stable even if a custom endpoint is malformed.
  }

  return `${endpoint.provider.id}:${endpoint.reachability}:${scheme}:${endpoint.label}`;
}

export function resolveTailscaleServeControlState(input: {
  readonly tailscaleServeEnabled: boolean;
  readonly endpointStatus: AdvertisedEndpoint["status"] | null;
}): "off" | "verifying" | "on" {
  if (!input.tailscaleServeEnabled) {
    return "off";
  }
  return input.endpointStatus === "available" ? "on" : "verifying";
}

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
