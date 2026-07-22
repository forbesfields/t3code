import { OrchestrationAdvisorReview } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import { AdvisorReviewError } from "../../../orchestration/Errors.ts";
import { AdvisorReviewReactor } from "../../../orchestration/Services/AdvisorReviewReactor.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

export const AdvisorConsultTool = Tool.make("advisor_consult", {
  description:
    "Ask the task's configured orchestrator to review bounded evidence. Call initial after exploration and before implementation. Call recovery at most once only when stuck or materially changing approach. Final review is run automatically by T3 Code.",
  parameters: Schema.Struct({
    stage: Schema.Literals(["initial", "recovery"]),
    summary: Schema.String,
  }),
  success: OrchestrationAdvisorReview,
  failure: AdvisorReviewError,
  dependencies: [McpInvocationContext.McpInvocationContext, AdvisorReviewReactor],
})
  .annotate(Tool.Title, "Consult task orchestrator")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const AdvisorToolkit = Toolkit.make(AdvisorConsultTool);
