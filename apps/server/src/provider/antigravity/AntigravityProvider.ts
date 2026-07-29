// @effect-diagnostics nodeBuiltinImport:off globalErrorInEffectCatch:off globalErrorInEffectFailure:off
import * as NodeChildProcess from "node:child_process";

import { type AntigravitySettings, type ServerProviderModel } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { buildServerProvider } from "../providerSnapshot.ts";

const EMPTY_CAPABILITIES = createModelCapabilities({ optionDescriptors: [] });

function runAntigravityCommand(
  binaryPath: string,
  args: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv,
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = NodeChildProcess.execFile(
      binaryPath,
      [...args],
      { env, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          Object.assign(error, { stdout, stderr });
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
    child.stdin?.end();
  });
}

function modelProvider(slug: string): string {
  if (slug.startsWith("claude-")) return "Anthropic";
  if (slug.startsWith("gpt-")) return "OpenAI";
  return "Google";
}

function normalizeModelSlug(line: string): string {
  if (/^[a-z0-9]+(?:[-.][a-z0-9]+)+$/u.test(line)) return line;
  const gemini = line.match(/^Gemini\s+(\d+\.\d+)\s+(Flash|Pro)\s+\(([^)]+)\)$/iu);
  if (gemini) {
    return `gemini-${gemini[1]}-${gemini[2]!.toLowerCase()}-${gemini[3]!.toLowerCase()}`;
  }
  const claude = line.match(/^Claude\s+(Sonnet|Opus)\s+(\d+\.\d+)(?:\s+\(([^)]+)\))?$/iu);
  if (claude) {
    return `claude-${claude[1]!.toLowerCase()}-${claude[2]!.replace(".", "-")}${
      claude[1]!.toLowerCase() === "opus" ? "-thinking" : ""
    }`;
  }
  const gpt = line.match(/^GPT-OSS\s+(.+?)\s+\(([^)]+)\)$/iu);
  if (gpt) {
    return `gpt-oss-${gpt[1]!.toLowerCase().replace(/\s+/gu, "-")}-${gpt[2]!.toLowerCase()}`;
  }
  return line
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

function modelName(slug: string): string {
  return slug
    .replace(/-(\d+)-(\d+)(?=-|$)/gu, "-$1.$2")
    .split("-")
    .map((part) => {
      if (part === "gpt") return "GPT";
      return part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part;
    })
    .join(" ");
}

export function mapAntigravityModels(stdout: string): ReadonlyArray<ServerProviderModel> {
  return [
    ...new Set(
      stdout
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .map(normalizeModelSlug),
    ),
  ].map((slug) => ({
    slug,
    name: modelName(slug),
    subProvider: modelProvider(slug),
    isCustom: false,
    capabilities: EMPTY_CAPABILITIES,
  }));
}

export const checkAntigravityProviderStatus = Effect.fn("checkAntigravityProviderStatus")(
  function* (settings: AntigravitySettings, env: NodeJS.ProcessEnv = process.env) {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    if (!settings.enabled) {
      return buildServerProvider({
        presentation: { displayName: "Antigravity", badgeLabel: "Google AI" },
        enabled: false,
        checkedAt,
        models: [],
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Antigravity is disabled in T3 Code settings.",
        },
      });
    }

    const inspected = yield* Effect.tryPromise({
      try: async () => {
        const [version, models] = await Promise.all([
          runAntigravityCommand(settings.binaryPath, ["--version"], env),
          runAntigravityCommand(settings.binaryPath, ["models"], env),
        ]);
        return {
          version: version.stdout.trim() || null,
          models: mapAntigravityModels(models.stdout),
        };
      },
      catch: (cause) => (cause instanceof Error ? cause : new Error("Could not inspect agy")),
    }).pipe(Effect.result);

    if (inspected._tag === "Failure") {
      const missing = "code" in inspected.failure && inspected.failure.code === "ENOENT";
      return buildServerProvider({
        presentation: { displayName: "Antigravity", badgeLabel: "Google AI" },
        enabled: true,
        checkedAt,
        models: [],
        probe: {
          installed: !missing,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: missing
            ? "Antigravity CLI (`agy`) is not installed or not on PATH."
            : inspected.failure.message,
        },
      });
    }

    const models = [...inspected.success.models];
    for (const slug of settings.customModels) {
      if (!slug.trim() || models.some((model) => model.slug === slug.trim())) continue;
      models.push({
        slug: slug.trim(),
        name: modelName(slug.trim()),
        subProvider: modelProvider(slug.trim()),
        isCustom: true,
        capabilities: EMPTY_CAPABILITIES,
      });
    }

    return buildServerProvider({
      presentation: { displayName: "Antigravity", badgeLabel: "Google AI" },
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: inspected.success.version,
        status: models.length > 0 ? "ready" : "warning",
        auth: { status: models.length > 0 ? "authenticated" : "unknown" },
        message:
          models.length > 0
            ? `${models.length} Antigravity models available.`
            : "Antigravity started, but no models were returned.",
      },
    });
  },
);

export const makePendingAntigravityProvider = Effect.fn("makePendingAntigravityProvider")(
  function* (settings: AntigravitySettings) {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    return buildServerProvider({
      presentation: { displayName: "Antigravity", badgeLabel: "Google AI" },
      enabled: settings.enabled,
      checkedAt,
      models: [],
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Discovering Antigravity models...",
      },
    });
  },
);
