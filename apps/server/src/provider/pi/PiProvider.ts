// @effect-diagnostics nodeBuiltinImport:off globalErrorInEffectCatch:off globalErrorInEffectFailure:off
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";

import {
  type PiSettings,
  type ServerProviderModel,
  type ServerProviderSlashCommand,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { buildServerProvider, type ServerProviderDraft } from "../providerSnapshot.ts";
import { PiRpcProcess } from "./PiRpcProcess.ts";

const execFileAsync = NodeUtil.promisify(NodeChildProcess.execFile);
const EMPTY_CAPABILITIES = createModelCapabilities({ optionDescriptors: [] });

interface PiModelLike {
  readonly provider?: unknown;
  readonly id?: unknown;
  readonly name?: unknown;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function mapPiModels(
  models: ReadonlyArray<PiModelLike>,
): ReadonlyArray<ServerProviderModel> {
  const seen = new Set<string>();
  const result: ServerProviderModel[] = [];
  for (const model of models) {
    if (typeof model.provider !== "string" || typeof model.id !== "string") continue;
    const provider = model.provider.trim();
    const id = model.id.trim();
    const slug = `${provider}/${id}`;
    if (!provider || !id || seen.has(slug)) continue;
    seen.add(slug);
    result.push({
      slug,
      name: typeof model.name === "string" && model.name.trim() ? model.name.trim() : id,
      subProvider: provider,
      isCustom: false,
      capabilities: EMPTY_CAPABILITIES,
    });
  }
  return result;
}

async function inspectPi(settings: PiSettings, cwd: string, env: NodeJS.ProcessEnv) {
  const client = new PiRpcProcess({
    binaryPath: settings.binaryPath,
    cwd,
    args: ["--no-session"],
    env: { ...env, PI_CODING_AGENT_DIR: settings.agentDir },
  });
  try {
    const [modelResponse, commandResponse] = await Promise.all([
      client.request({ type: "get_available_models" }, 30_000),
      client.request({ type: "get_commands" }, 30_000),
    ]);
    const modelData = record(modelResponse.data);
    const commandData = record(commandResponse.data);
    const models = Array.isArray(modelData?.models) ? mapPiModels(modelData.models) : [];
    const slashCommands: ServerProviderSlashCommand[] = [];
    if (Array.isArray(commandData?.commands)) {
      for (const entry of commandData.commands) {
        const command = record(entry);
        if (!command || typeof command.name !== "string" || !command.name.trim()) continue;
        slashCommands.push({
          name: command.name.trim(),
          ...(typeof command.description === "string" && command.description.trim()
            ? { description: command.description.trim() }
            : {}),
        });
      }
    }
    return { models, slashCommands };
  } finally {
    client.close();
  }
}

export const checkPiProviderStatus = Effect.fn("checkPiProviderStatus")(function* (
  settings: PiSettings,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<ServerProviderDraft> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  if (!settings.enabled) {
    return buildServerProvider({
      presentation: { displayName: "Pi", badgeLabel: "Personal Fork" },
      enabled: false,
      checkedAt,
      models: [],
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Pi is disabled in T3 Code settings.",
      },
    });
  }

  const inspected = yield* Effect.tryPromise({
    try: () => inspectPi(settings, cwd, env),
    catch: (cause) => (cause instanceof Error ? cause : new Error("Could not inspect Pi")),
  }).pipe(Effect.result);

  if (inspected._tag === "Failure") {
    return buildServerProvider({
      presentation: { displayName: "Pi", badgeLabel: "Personal Fork" },
      enabled: true,
      checkedAt,
      models: [],
      probe: {
        installed: false,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message:
          inspected.failure instanceof Error
            ? inspected.failure.message
            : "Could not start Pi JSON-RPC.",
      },
    });
  }

  const version = yield* Effect.tryPromise({
    try: () => execFileAsync(settings.binaryPath, ["--version"], { env }),
    catch: (cause) => (cause instanceof Error ? cause : new Error("Could not read Pi version")),
  }).pipe(
    Effect.map((result) => result.stdout.trim() || null),
    Effect.orElseSucceed(() => null),
  );

  const configuredModels = inspected.success.models;
  return buildServerProvider({
    presentation: { displayName: "Pi", badgeLabel: "Personal Fork" },
    enabled: true,
    checkedAt,
    models: configuredModels,
    slashCommands: inspected.success.slashCommands,
    probe: {
      installed: true,
      version,
      status: configuredModels.length > 0 ? "ready" : "warning",
      auth: { status: configuredModels.length > 0 ? "authenticated" : "unknown" },
      message:
        configuredModels.length > 0
          ? `${configuredModels.length} Pi models available.`
          : "Pi started, but no configured models were returned.",
    },
  });
});

export const makePendingPiProvider = Effect.fn("makePendingPiProvider")(function* (
  settings: PiSettings,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  return buildServerProvider({
    presentation: { displayName: "Pi", badgeLabel: "Personal Fork" },
    enabled: settings.enabled,
    checkedAt,
    models: [],
    probe: {
      installed: true,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Discovering Pi models and commands...",
    },
  });
});
