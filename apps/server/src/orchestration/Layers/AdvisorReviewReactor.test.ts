import { describe, expect, it } from "vite-plus/test";
import { MessageId } from "@t3tools/contracts";

import { __testing } from "./AdvisorReviewReactor.ts";

describe("AdvisorReviewReactor state transitions", () => {
  it("recognizes synthetic correction turns even though user messages are not turn-bound", () => {
    const message = (id: string) => ({
      id: MessageId.make(id),
      role: "user" as const,
      text: "work",
      attachments: [],
      turnId: null,
      streaming: false,
      createdAt: "2026-07-21T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:00.000Z",
    });

    expect(__testing.isCorrectionTurn([message("user:1")])).toBe(false);
    expect(__testing.isCorrectionTurn([message("advisor-correction:review-1")])).toBe(true);
    expect(
      __testing.isCorrectionTurn([
        message("advisor-correction:review-1"),
        message("user:next-task"),
      ]),
    ).toBe(false);
    const review = {
      id: "review-1",
      turnId: "turn-1",
    } as Parameters<typeof __testing.hasCorrectionMessage>[1];
    expect(__testing.hasCorrectionMessage([message("advisor-correction:review-1")], review)).toBe(
      true,
    );
  });

  it("requires a blocker-free final ship verdict before approval", () => {
    expect(
      __testing.resolveReviewTransition({
        stage: "final",
        verdict: "ship",
        openBlockerCount: 0,
        correctionAttempts: 1,
        maxCorrectionAttempts: 2,
      }),
    ).toEqual({ verdict: "ship", status: "approved", correctionAttempts: 1 });
    expect(
      __testing.resolveReviewTransition({
        stage: "final",
        verdict: "ship",
        openBlockerCount: 1,
        correctionAttempts: 0,
        maxCorrectionAttempts: 2,
      }),
    ).toEqual({ verdict: "fix", status: "correcting", correctionAttempts: 1 });
  });

  it("allows two corrective turns, then pauses for the user", () => {
    const transition = (correctionAttempts: number) =>
      __testing.resolveReviewTransition({
        stage: "final",
        verdict: "fix",
        openBlockerCount: 1,
        correctionAttempts,
        maxCorrectionAttempts: 2,
      });

    expect(transition(0).status).toBe("correcting");
    expect(transition(0).correctionAttempts).toBe(1);
    expect(transition(1).status).toBe("correcting");
    expect(transition(1).correctionAttempts).toBe(2);
    expect(transition(2)).toMatchObject({
      status: "waiting_for_input",
      correctionAttempts: 2,
    });
  });

  it("pauses immediately for need_human and keeps non-final guidance non-terminal", () => {
    expect(
      __testing.resolveReviewTransition({
        stage: "final",
        verdict: "need_human",
        openBlockerCount: 0,
        correctionAttempts: 0,
        maxCorrectionAttempts: 2,
      }).status,
    ).toBe("waiting_for_input");
    expect(
      __testing.resolveReviewTransition({
        stage: "initial",
        verdict: "continue",
        openBlockerCount: 0,
        correctionAttempts: 0,
        maxCorrectionAttempts: 2,
      }).status,
    ).toBe("idle");
  });
});
