import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId, TurnId, EventId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { AdvisorReviewReactor } from "../../../orchestration/Services/AdvisorReviewReactor.ts";
import { handleAdvisorConsult } from "./handlers.ts";

const threadId = ThreadId.make("thread-scoped");
const invocation = (capabilities: ReadonlySet<"preview" | "advisor">) =>
  McpInvocationContext.McpInvocationContext.of({
    environmentId: EnvironmentId.make("environment-local"),
    threadId,
    providerSessionId: "provider-session-1",
    providerInstanceId: ProviderInstanceId.make("codex"),
    capabilities,
    issuedAt: 1,
  });

describe("advisor_consult MCP handler", () => {
  it.effect("uses the authenticated thread scope instead of worker-provided routing", () =>
    Effect.gen(function* () {
      const received = yield* Ref.make<unknown>(null);
      const review = {
        id: EventId.make("review-1"),
        turnId: TurnId.make("turn-1"),
        stage: "initial" as const,
        verdict: "continue" as const,
        summary: "Continue with the bounded plan.",
        evidenceSummary: "Repository exploration was summarized.",
        blockers: [],
        attempt: 0,
        createdAt: "2026-07-21T00:00:00.000Z",
        completedAt: "2026-07-21T00:00:01.000Z",
      };
      const result = yield* handleAdvisorConsult({
        stage: "initial",
        summary: "Explored the repository.",
      }).pipe(
        Effect.provideService(
          McpInvocationContext.McpInvocationContext,
          invocation(new Set(["advisor"])),
        ),
        Effect.provideService(
          AdvisorReviewReactor,
          AdvisorReviewReactor.of({
            consult: (input) => Ref.set(received, input).pipe(Effect.as(review)),
            start: () => Effect.void,
            drain: Effect.void,
          }),
        ),
      );

      expect(result).toBe(review);
      expect(yield* Ref.get(received)).toMatchObject({
        threadId,
        stage: "initial",
        workerSummary: "Explored the repository.",
      });
    }),
  );

  it.effect("rejects credentials without advisor capability", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        handleAdvisorConsult({ stage: "recovery", summary: "Need another approach." }).pipe(
          Effect.provideService(
            McpInvocationContext.McpInvocationContext,
            invocation(new Set(["preview"])),
          ),
          Effect.provideService(
            AdvisorReviewReactor,
            AdvisorReviewReactor.of({
              consult: () => Effect.die("advisor should not be called"),
              start: () => Effect.void,
              drain: Effect.void,
            }),
          ),
        ),
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );
});
