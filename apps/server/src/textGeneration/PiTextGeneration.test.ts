// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { makePiTextGeneration } from "./PiTextGeneration.ts";

const fixture = NodeURL.fileURLToPath(new URL("./fixtures/fake-pi-text.mjs", import.meta.url));

describe("PiTextGeneration", () => {
  it.effect("runs an ephemeral tool-denied advisor with the selected model", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-pi-text-test-"))),
      (directory) =>
        Effect.gen(function* () {
          const argsPath = NodePath.join(directory, "args.json");
          const service = makePiTextGeneration(
            { enabled: true, binaryPath: fixture, agentDir: directory, customModels: [] },
            { PI_TEST_ARGS_PATH: argsPath },
          );

          const result = yield* service.generateAdvisorReview({
            cwd: directory,
            prompt: "Review this bounded evidence package.",
            modelSelection: {
              instanceId: ProviderInstanceId.make("pi_review"),
              model: "openai/gpt-5.4",
            },
          });
          const args = JSON.parse(NodeFS.readFileSync(argsPath, "utf8")) as string[];

          expect(args).toEqual([
            "--mode",
            "text",
            "--print",
            "--no-session",
            "--no-tools",
            "--no-skills",
            "--no-context-files",
            "--model",
            "openai/gpt-5.4",
            "Review this bounded evidence package.",
          ]);
          expect(result.verdict).toBe("fix");
          expect(result.blockers).toHaveLength(1);
        }),
      (directory) => Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true })),
    ),
  );
});
