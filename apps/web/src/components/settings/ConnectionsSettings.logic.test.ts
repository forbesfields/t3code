import type { AdvertisedEndpoint } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  applyWslEnableSelection,
  isTailscaleIpv4Host,
  isTailscaleTailnetHost,
  preferredRemoteEnvironmentUrlHint,
  selectPairingEndpoint,
} from "./ConnectionsSettings.logic";

const baseWslState = {
  enabled: false,
  distro: null,
  available: true,
  wslOnly: true,
  distros: [],
  preflightError: null,
};

describe("applyWslEnableSelection", () => {
  it("clears WSL-only and updates the distro before enabling both backends", async () => {
    const calls: Array<string> = [];
    let persistedWslOnly = true;
    let persistedDistro: string | null = "Ubuntu";
    const setWslDistro = vi.fn(async (distro: string | null) => {
      calls.push(`setWslDistro:${distro ?? "default"}`);
      persistedDistro = distro;
      return { ...baseWslState, distro, wslOnly: persistedWslOnly };
    });
    const setWslBackendEnabled = vi.fn(async (enabled: boolean) => {
      calls.push(`setWslBackendEnabled:${enabled}`);
      return {
        ...baseWslState,
        enabled,
        distro: persistedDistro,
        wslOnly: persistedWslOnly,
      };
    });
    const setWslOnly = vi.fn(async (enabled: boolean) => {
      calls.push(`setWslOnly:${enabled}`);
      persistedWslOnly = enabled;
      return { ...baseWslState, distro: persistedDistro, wslOnly: enabled };
    });

    const state = await applyWslEnableSelection({
      bridge: { setWslDistro, setWslBackendEnabled, setWslOnly },
      mode: "both",
      nextDistro: "Debian",
      persistedDistro: "Ubuntu",
    });

    expect(calls).toEqual(["setWslOnly:false", "setWslDistro:Debian", "setWslBackendEnabled:true"]);
    expect(state).toMatchObject({ enabled: true, distro: "Debian", wslOnly: false });
  });

  it("stages WSL-only before enabling without rewriting an unchanged distro", async () => {
    const calls: Array<string> = [];
    let persistedWslOnly = false;
    const setWslDistro = vi.fn(async () => baseWslState);
    const setWslOnly = vi.fn(async (enabled: boolean) => {
      calls.push(`setWslOnly:${enabled}`);
      persistedWslOnly = enabled;
      return { ...baseWslState, wslOnly: enabled };
    });
    const setWslBackendEnabled = vi.fn(async (enabled: boolean) => {
      calls.push(`setWslBackendEnabled:${enabled}`);
      return { ...baseWslState, enabled, wslOnly: persistedWslOnly };
    });

    const state = await applyWslEnableSelection({
      bridge: { setWslDistro, setWslBackendEnabled, setWslOnly },
      mode: "wsl-only",
      nextDistro: null,
      persistedDistro: null,
    });

    expect(calls).toEqual(["setWslOnly:true", "setWslBackendEnabled:true"]);
    expect(setWslDistro).not.toHaveBeenCalled();
    expect(state).toMatchObject({ enabled: true, wslOnly: true });
  });
});

function endpoint(
  partial: Partial<AdvertisedEndpoint> & Pick<AdvertisedEndpoint, "id" | "httpBaseUrl">,
): AdvertisedEndpoint {
  return {
    provider: { id: "desktop-core", label: "Desktop", kind: "core", isAddon: false },
    source: "desktop-core",
    label: partial.label ?? "Endpoint",
    reachability: partial.reachability ?? "lan",
    status: partial.status ?? "available",
    compatibility: partial.compatibility ?? {},
    description: partial.description ?? null,
    isDefault: partial.isDefault ?? false,
    ...partial,
  };
}

describe("selectPairingEndpoint", () => {
  it("prefers Tailscale HTTPS over LAN when both are available", () => {
    const selected = selectPairingEndpoint([
      endpoint({
        id: "desktop-lan:http://192.168.1.20:3773",
        httpBaseUrl: "http://192.168.1.20:3773/",
        isDefault: true,
      }),
      endpoint({
        id: "tailscale-magicdns:https://macbook.tailnet.ts.net",
        httpBaseUrl: "https://macbook.tailnet.ts.net/",
        reachability: "private-network",
        compatibility: { hostedHttpsApp: "compatible" },
      }),
    ]);

    expect(selected?.id).toBe("tailscale-magicdns:https://macbook.tailnet.ts.net");
  });
});

describe("preferredRemoteEnvironmentUrlHint", () => {
  it("nudges away from raw Tailscale IPs", () => {
    expect(preferredRemoteEnvironmentUrlHint("http://100.64.0.2:3773")).toMatch(/MagicDNS/i);
    expect(preferredRemoteEnvironmentUrlHint("https://mac.tailnet.ts.net")).toBeNull();
  });

  it("detects tailnet hosts", () => {
    expect(isTailscaleTailnetHost("https://mac.tailnet.ts.net")).toBe(true);
    expect(isTailscaleIpv4Host("100.64.0.2:3773")).toBe(true);
  });
});
