import type {
  OrchestrationAdvisorReview,
  OrchestrationAdvisorReviewStage,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import type { AdvisorReviewError } from "../Errors.ts";

export interface AdvisorConsultInput {
  readonly threadId: ThreadId;
  readonly turnId?: TurnId | undefined;
  readonly stage: OrchestrationAdvisorReviewStage;
  readonly workerSummary: string;
  readonly force?: boolean | undefined;
}

export interface AdvisorReviewReactorShape {
  readonly consult: (
    input: AdvisorConsultInput,
  ) => Effect.Effect<OrchestrationAdvisorReview, AdvisorReviewError>;
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class AdvisorReviewReactor extends Context.Service<
  AdvisorReviewReactor,
  AdvisorReviewReactorShape
>()("t3/orchestration/Services/AdvisorReviewReactor") {}
