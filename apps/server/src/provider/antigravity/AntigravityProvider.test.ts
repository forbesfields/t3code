import { describe, expect, it } from "@effect/vitest";
import * as NodeURL from "node:url";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { AntigravitySettings } from "@t3tools/contracts";
import { checkAntigravityProviderStatus, mapAntigravityModels } from "./AntigravityProvider.ts";

const fixture = NodeURL.fileURLToPath(new URL("./fixtures/fake-agy.mjs", import.meta.url));
const decodeSettings = Schema.decodeSync(AntigravitySettings);
const fixtureSettings = decodeSettings({ binaryPath: fixture });

describe("mapAntigravityModels", () => {
  it("maps newline-delimited model ids and removes duplicates", () => {
    expect(
      mapAntigravityModels(
        ["gemini-3.6-flash-high", "claude-sonnet-4-6", "gemini-3.6-flash-high", ""].join("\n"),
      ).map(({ slug, name, subProvider }) => ({ slug, name, subProvider })),
    ).toEqual([
      {
        slug: "gemini-3.6-flash-high",
        name: "Gemini 3.6 Flash High",
        subProvider: "Google",
      },
      {
        slug: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        subProvider: "Anthropic",
      },
    ]);
  });

  it("normalizes the human-readable model list emitted by older agy builds", () => {
    expect(
      mapAntigravityModels(
        ["Gemini 3.6 Flash (High)", "Claude Sonnet 4.6 (Thinking)", "GPT-OSS 120B (Medium)"].join(
          "\n",
        ),
      ).map((model) => model.slug),
    ).toEqual(["gemini-3.6-flash-high", "claude-sonnet-4-6", "gpt-oss-120b-medium"]);
  });
});

describe("checkAntigravityProviderStatus", () => {
  it.effect("probes the installed CLI and exposes its model list", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkAntigravityProviderStatus(fixtureSettings);
      expect(snapshot.status).toBe("ready");
      expect(snapshot.version).toBe("1.1.8");
      expect(snapshot.models.map((model) => model.slug)).toEqual([
        "gemini-3.6-flash-high",
        "claude-sonnet-4-6",
      ]);
    }),
  );
});
