import * as Effect from "effect/Effect";

import { AdvisorReviewReactor } from "../../../orchestration/Services/AdvisorReviewReactor.ts";
import { AdvisorReviewError } from "../../../orchestration/Errors.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { AdvisorToolkit } from "./tools.ts";

export const handleAdvisorConsult = Effect.fn("AdvisorToolkit.consult")(function* (input: {
  readonly stage: "initial" | "recovery";
  readonly summary: string;
}) {
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  if (!invocation.capabilities.has("advisor")) {
    return yield* new AdvisorReviewError({
      threadId: invocation.threadId,
      stage: input.stage,
      detail: "This provider-scoped MCP credential does not grant advisor access.",
    });
  }
  const advisor = yield* AdvisorReviewReactor;
  return yield* advisor.consult({
    threadId: invocation.threadId,
    stage: input.stage,
    workerSummary: input.summary,
  });
});

export const AdvisorToolkitHandlersLive = AdvisorToolkit.toLayer({
  advisor_consult: handleAdvisorConsult,
});
