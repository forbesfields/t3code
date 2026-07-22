// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";

import { TextGenerationError, type PiSettings } from "@t3tools/contracts";
import { extractJsonObject } from "@t3tools/shared/schemaJson";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as TextGeneration from "./TextGeneration.ts";

const execFileAsync = NodeUtil.promisify(NodeChildProcess.execFile);
const ADVISOR_TIMEOUT_MS = 180_000;
const decodeAdvisorReview = Schema.decodeEffect(
  Schema.fromJsonString(TextGeneration.AdvisorReviewGenerationOutput),
);

const unsupported = (operation: string) =>
  Effect.fail(
    new TextGenerationError({
      operation,
      detail: "Pi is not configured for this one-shot text-generation operation.",
    }),
  );

export const makePiTextGeneration = (
  settings: PiSettings,
  environment?: NodeJS.ProcessEnv,
): TextGeneration.TextGeneration["Service"] => {
  const generateAdvisorReview: TextGeneration.TextGeneration["Service"]["generateAdvisorReview"] =
    Effect.fn("PiTextGeneration.generateAdvisorReview")(function* (input) {
      const output = yield* Effect.tryPromise({
        try: () =>
          execFileAsync(
            settings.binaryPath,
            [
              "--mode",
              "text",
              "--print",
              "--no-session",
              "--no-tools",
              "--no-skills",
              "--no-context-files",
              "--model",
              input.modelSelection.model,
              input.prompt,
            ],
            {
              cwd: input.cwd,
              env: {
                ...process.env,
                ...environment,
                PI_CODING_AGENT_DIR: settings.agentDir,
              },
              timeout: ADVISOR_TIMEOUT_MS,
              maxBuffer: 2 * 1024 * 1024,
            },
          ),
        catch: (cause) =>
          new TextGenerationError({
            operation: "generateAdvisorReview",
            detail: cause instanceof Error ? cause.message : "Pi advisor invocation failed.",
            cause,
          }),
      });

      const raw = output.stdout.trim();
      if (raw.length === 0) {
        return yield* new TextGenerationError({
          operation: "generateAdvisorReview",
          detail: "Pi returned an empty advisor response.",
        });
      }
      return yield* decodeAdvisorReview(extractJsonObject(raw)).pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: "generateAdvisorReview",
              detail: "Pi returned a malformed advisor response.",
              cause,
            }),
        ),
      );
    });

  return TextGeneration.TextGeneration.of({
    generateCommitMessage: () => unsupported("generateCommitMessage"),
    generatePrContent: () => unsupported("generatePrContent"),
    generateBranchName: () => unsupported("generateBranchName"),
    generateThreadTitle: () => unsupported("generateThreadTitle"),
    generateAdvisorReview,
  });
};
