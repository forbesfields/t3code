import { TextGenerationError, type AntigravitySettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as TextGeneration from "./TextGeneration.ts";

export const makeAntigravityTextGeneration = (
  _settings: AntigravitySettings,
): TextGeneration.TextGeneration["Service"] => {
  const unsupported = (operation: string) =>
    Effect.fail(
      new TextGenerationError({
        operation,
        detail: "Antigravity is not configured for this one-shot text-generation operation.",
      }),
    );

  return TextGeneration.TextGeneration.of({
    generateCommitMessage: () => unsupported("generateCommitMessage"),
    generatePrContent: () => unsupported("generatePrContent"),
    generateBranchName: () => unsupported("generateBranchName"),
    generateThreadTitle: () => unsupported("generateThreadTitle"),
    generateAdvisorReview: () => unsupported("generateAdvisorReview"),
  });
};
