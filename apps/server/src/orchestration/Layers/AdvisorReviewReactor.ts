import {
  CommandId,
  EventId,
  MessageId,
  type OrchestrationAdvisorBlocker,
  type OrchestrationAdvisorReview,
  type OrchestrationAdvisorReviewStage,
  type OrchestrationAdvisorState,
  type OrchestrationAdvisorVerdict,
  type OrchestrationEvent,
  type OrchestrationThread,
  type ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as CheckpointStore from "../../checkpointing/CheckpointStore.ts";
import { checkpointRefForThreadTurn } from "../../checkpointing/Utils.ts";
import * as ProviderInstanceRegistry from "../../provider/Services/ProviderInstanceRegistry.ts";
import * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import { buildAdvisorReviewPrompt } from "../../textGeneration/TextGenerationPrompts.ts";
import { AdvisorReviewError } from "../Errors.ts";
import {
  AdvisorReviewReactor,
  type AdvisorConsultInput,
  type AdvisorReviewReactorShape,
} from "../Services/AdvisorReviewReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";

const CORRECTION_MESSAGE_PREFIX = "advisor-correction:";
const INITIAL_CHECKPOINT_BLOCKER = "The required initial orchestrator checkpoint was skipped.";
const CORRECTION_LIMIT_ERROR = "The corrective-attempt limit was reached.";

type ReactorInput =
  | Extract<
      OrchestrationEvent,
      {
        type:
          | "thread.turn-diff-completed"
          | "thread.advisor-response-requested"
          | "thread.turn-interrupt-requested";
      }
    >
  | { readonly type: "restart.review"; readonly threadId: ThreadId; readonly turnId: TurnId };

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function trimSection(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…[truncated ${value.length - max} characters]`;
}

function reviewFromActivity(
  thread: OrchestrationThread,
  turnId: TurnId,
  stage: OrchestrationAdvisorReviewStage,
): OrchestrationAdvisorReview | undefined {
  for (const activity of thread.activities.toReversed()) {
    if (activity.kind !== "advisor.review") continue;
    const payload = record(activity.payload);
    const review = record(payload?.review);
    if (review?.turnId === turnId && review.stage === stage) {
      return review as unknown as OrchestrationAdvisorReview;
    }
  }
  return undefined;
}

function currentTurnId(thread: OrchestrationThread, requested?: TurnId): TurnId | undefined {
  return requested ?? thread.session?.activeTurnId ?? thread.latestTurn?.turnId ?? undefined;
}

function isCorrectionTurn(messages: OrchestrationThread["messages"]): boolean {
  return (
    messages
      .toReversed()
      .find((message) => message.role === "user")
      ?.id.startsWith(CORRECTION_MESSAGE_PREFIX) === true
  );
}

function hasCorrectionMessage(
  messages: OrchestrationThread["messages"],
  review: OrchestrationAdvisorReview,
): boolean {
  return messages.some((message) => message.id === `${CORRECTION_MESSAGE_PREFIX}${review.id}`);
}

function resolveReviewTransition(input: {
  readonly stage: OrchestrationAdvisorReviewStage;
  readonly verdict: OrchestrationAdvisorVerdict;
  readonly openBlockerCount: number;
  readonly correctionAttempts: number;
  readonly maxCorrectionAttempts: number;
}): {
  readonly verdict: OrchestrationAdvisorVerdict;
  readonly status: OrchestrationAdvisorState["status"];
  readonly correctionAttempts: number;
} {
  const verdict =
    input.stage === "final" && input.verdict === "ship" && input.openBlockerCount > 0
      ? "fix"
      : input.verdict;
  if (input.stage !== "final") {
    return {
      verdict,
      status: verdict === "need_human" ? "waiting_for_input" : "idle",
      correctionAttempts: input.correctionAttempts,
    };
  }
  if (verdict === "ship" && input.openBlockerCount === 0) {
    return { verdict, status: "approved", correctionAttempts: input.correctionAttempts };
  }
  if (verdict === "need_human" || input.correctionAttempts >= input.maxCorrectionAttempts) {
    return { verdict, status: "waiting_for_input", correctionAttempts: input.correctionAttempts };
  }
  return {
    verdict,
    status: "correcting",
    correctionAttempts: input.correctionAttempts + 1,
  };
}

export const __testing = { hasCorrectionMessage, isCorrectionTurn, resolveReviewTransition };

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const engine = yield* OrchestrationEngineService;
  const query = yield* ProjectionSnapshotQuery;
  const checkpointStore = yield* CheckpointStore.CheckpointStore;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const providerInstances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const reviewLock = yield* Semaphore.make(1);
  const activeReviewCancellations = new Map<ThreadId, Deferred.Deferred<void>>();

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const newEventId = crypto.randomUUIDv4.pipe(Effect.map(EventId.make));
  const newCommandId = (tag: string) =>
    crypto.randomUUIDv4.pipe(Effect.map((id) => CommandId.make(`server:${tag}:${id}`)));

  const getThread = Effect.fn("AdvisorReview.getThread")(function* (threadId: ThreadId) {
    return yield* query.getThreadDetailById(threadId).pipe(Effect.map(Option.getOrUndefined));
  });

  const setState = (threadId: ThreadId, state: OrchestrationAdvisorState) =>
    Effect.gen(function* () {
      yield* engine.dispatch({
        type: "thread.advisor-state.set",
        commandId: yield* newCommandId("advisor-state"),
        threadId,
        state,
        createdAt: state.updatedAt,
      });
    });

  const appendActivity = (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId | null;
    readonly tone: "info" | "error";
    readonly kind: string;
    readonly summary: string;
    readonly payload: unknown;
    readonly createdAt: string;
  }) =>
    Effect.gen(function* () {
      yield* engine.dispatch({
        type: "thread.activity.append",
        commandId: yield* newCommandId("advisor-activity"),
        threadId: input.threadId,
        activity: {
          id: yield* newEventId,
          tone: input.tone,
          kind: input.kind,
          summary: input.summary,
          payload: input.payload,
          turnId: input.turnId,
          createdAt: input.createdAt,
        },
        createdAt: input.createdAt,
      });
    });

  const readInstructionFiles = Effect.fn("AdvisorReview.readInstructionFiles")(function* (
    roots: ReadonlyArray<string>,
  ) {
    const sections: string[] = [];
    for (const root of new Set(roots)) {
      for (const name of ["AGENTS.md", "CLAUDE.md"]) {
        const filePath = path.join(root, name);
        const content = yield* fileSystem
          .readFileString(filePath)
          .pipe(Effect.orElseSucceed(() => ""));
        if (content.trim()) sections.push(`${filePath}:\n${trimSection(content, 12_000)}`);
      }
    }
    return sections.join("\n\n");
  });

  const buildEvidence = Effect.fn("AdvisorReview.buildEvidence")(function* (
    thread: OrchestrationThread,
    turnId: TurnId,
  ) {
    const project = yield* query
      .getProjectShellById(thread.projectId)
      .pipe(Effect.map(Option.getOrUndefined));
    const cwd = thread.worktreePath ?? project?.workspaceRoot;
    const instructions = project
      ? yield* readInstructionFiles([project.workspaceRoot, ...(cwd ? [cwd] : [])])
      : "";
    const checkpoint = thread.checkpoints
      .filter((entry) => entry.turnId === turnId)
      .toSorted((left, right) => right.checkpointTurnCount - left.checkpointTurnCount)[0];
    const diff =
      cwd && checkpoint
        ? yield* checkpointStore
            .diffCheckpoints({
              cwd,
              fromCheckpointRef: checkpointRefForThreadTurn(thread.id, 0),
              toCheckpointRef: checkpoint.checkpointRef,
              fallbackFromToHead: true,
              ignoreWhitespace: false,
            })
            .pipe(Effect.orElseSucceed(() => "[checkpoint diff unavailable]"))
        : "[no checkpoint diff available]";
    const verificationActivities = thread.activities.filter((activity) =>
      /test|check|lint|typecheck|verify|command/i.test(`${activity.kind} ${activity.summary}`),
    );
    const recentActivities = thread.activities.slice(-50);
    const fileSummary = checkpoint
      ? checkpoint.files.map(
          (file) => `${file.kind} ${file.path} (+${file.additions} -${file.deletions})`,
        )
      : [];

    return [
      "Repository instructions:\n" + trimSection(instructions || "[none captured]", 24_000),
      "Checkpoint file summary (preserved):\n" +
        trimSection(fileSummary.join("\n") || "[none]", 12_000),
      "Captured verification activity (preserved):\n" +
        trimSection(safeJson(verificationActivities), 18_000),
      "Recent activity:\n" + trimSection(safeJson(recentActivities), 16_000),
      "Checkpoint diff (includes untracked files captured by the checkpoint):\n" +
        trimSection(diff, 42_000),
    ].join("\n\n");
  });

  const reconcileBlockers = Effect.fn("AdvisorReview.reconcileBlockers")(function* (
    prior: ReadonlyArray<OrchestrationAdvisorBlocker>,
    next: TextGeneration.AdvisorReviewGenerationOutput["blockers"],
  ) {
    const consumed = new Set<number>();
    const blockers: OrchestrationAdvisorBlocker[] = [];
    for (const previous of prior) {
      const matchIndex = next.findIndex(
        (candidate, index) =>
          !consumed.has(index) &&
          (candidate.id === previous.id || candidate.requirement === previous.requirement),
      );
      if (matchIndex < 0) {
        blockers.push(previous);
        continue;
      }
      consumed.add(matchIndex);
      const candidate = next[matchIndex]!;
      blockers.push({
        id: previous.id,
        requirement: candidate.requirement.trim() || previous.requirement,
        evidenceRequired: candidate.evidenceRequired.trim() || previous.evidenceRequired,
        status: previous.status === "waived" ? "waived" : candidate.status,
      });
    }
    for (const [index, candidate] of next.entries()) {
      if (consumed.has(index)) continue;
      blockers.push({
        id: yield* newEventId,
        requirement: candidate.requirement.trim() || "Advisor requirement",
        evidenceRequired: candidate.evidenceRequired.trim() || "Concrete verification evidence",
        status: candidate.status,
      });
    }
    return blockers;
  });

  const dispatchCorrectionTurn = Effect.fn("AdvisorReview.dispatchCorrectionTurn")(function* (
    thread: OrchestrationThread,
    review: OrchestrationAdvisorReview,
  ) {
    const openBlockers = review.blockers.filter((blocker) => blocker.status === "open");
    const blockerText = openBlockers
      .map(
        (blocker, index) =>
          `${index + 1}. ${blocker.requirement}\n   Required evidence: ${blocker.evidenceRequired}`,
      )
      .join("\n");
    const createdAt = yield* nowIso;
    yield* engine.dispatch({
      type: "thread.turn.start",
      commandId: yield* newCommandId("advisor-correction-turn"),
      threadId: thread.id,
      message: {
        messageId: MessageId.make(`${CORRECTION_MESSAGE_PREFIX}${review.id}`),
        role: "user",
        text: [
          "Orchestrator correction required. Address every open blocker, then provide the requested evidence.",
          review.instruction ?? "",
          blockerText,
        ]
          .filter(Boolean)
          .join("\n\n"),
        attachments: [],
      },
      modelSelection: thread.modelSelection,
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      createdAt,
    });
  });

  const consultUnlocked = Effect.fn("AdvisorReview.consult")(function* (
    input: AdvisorConsultInput,
  ): Effect.fn.Return<OrchestrationAdvisorReview, AdvisorReviewError> {
    const thread = yield* getThread(input.threadId).pipe(
      Effect.mapError(
        (cause) =>
          new AdvisorReviewError({
            threadId: input.threadId,
            stage: input.stage,
            detail: "Could not load the thread projection.",
            cause,
          }),
      ),
    );
    if (!thread?.advisor) {
      return yield* new AdvisorReviewError({
        threadId: input.threadId,
        stage: input.stage,
        detail: "Orchestrated mode is not enabled for this thread.",
      });
    }
    const turnId = currentTurnId(thread, input.turnId);
    if (!turnId) {
      return yield* new AdvisorReviewError({
        threadId: input.threadId,
        stage: input.stage,
        detail: "No active or completed worker turn is available for review.",
      });
    }
    const existing = reviewFromActivity(thread, turnId, input.stage);
    if (existing && !input.force) return existing;
    const projectedReview = thread.advisor.state.lastReview;
    if (
      !input.force &&
      projectedReview?.turnId === turnId &&
      projectedReview.stage === input.stage
    ) {
      yield* appendActivity({
        threadId: thread.id,
        turnId,
        tone: thread.advisor.state.status === "waiting_for_input" ? "error" : "info",
        kind: "advisor.review",
        summary: `${input.stage} review: ${projectedReview.verdict}`,
        payload: {
          review: projectedReview,
          modelSelection: thread.advisor.config.modelSelection,
          status: thread.advisor.state.status,
        },
        createdAt: projectedReview.completedAt,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new AdvisorReviewError({
              threadId: input.threadId,
              stage: input.stage,
              detail: "Could not recover the persisted review activity.",
              cause,
            }),
        ),
      );
      if (
        thread.advisor.state.status === "correcting" &&
        !hasCorrectionMessage(thread.messages, projectedReview)
      ) {
        yield* dispatchCorrectionTurn(thread, projectedReview).pipe(
          Effect.mapError(
            (cause) =>
              new AdvisorReviewError({
                threadId: input.threadId,
                stage: input.stage,
                detail: "Could not recover the corrective worker turn.",
                cause,
              }),
          ),
        );
      }
      return projectedReview;
    }
    if (
      input.stage !== "final" &&
      thread.activities.some((activity) => {
        if (activity.kind !== "advisor.review") return false;
        const review = record(record(activity.payload)?.review);
        return review?.turnId === turnId && review.stage === input.stage;
      })
    ) {
      return yield* new AdvisorReviewError({
        threadId: input.threadId,
        stage: input.stage,
        detail: `The ${input.stage} checkpoint has already been used for this worker turn.`,
      });
    }

    const instance = yield* providerInstances.getInstance(
      thread.advisor.config.modelSelection.instanceId,
    );
    if (!instance?.supportsAdvisorReview) {
      return yield* new AdvisorReviewError({
        threadId: input.threadId,
        stage: input.stage,
        detail: "The selected provider instance does not advertise advisor-review capability.",
      });
    }

    const createdAt = yield* nowIso;
    const correctionAttempts = isCorrectionTurn(thread.messages)
      ? thread.advisor.state.correctionAttempts
      : 0;
    const priorBlockers = [...thread.advisor.state.blockers];
    const missingInitialCheckpoint =
      input.stage === "final" && reviewFromActivity(thread, turnId, "initial") === undefined;
    if (
      missingInitialCheckpoint &&
      !priorBlockers.some(
        (blocker) =>
          blocker.requirement === INITIAL_CHECKPOINT_BLOCKER && blocker.status === "open",
      )
    ) {
      const blockerId = yield* newEventId.pipe(
        Effect.mapError(
          (cause) =>
            new AdvisorReviewError({
              threadId: input.threadId,
              stage: input.stage,
              detail: "Could not persist the missing-checkpoint blocker.",
              cause,
            }),
        ),
      );
      priorBlockers.push({
        id: blockerId,
        requirement: INITIAL_CHECKPOINT_BLOCKER,
        evidenceRequired:
          "A corrective worker turn must call advisor_consult at the initial stage before making further changes.",
        status: "open",
      });
    }
    const reviewingState: OrchestrationAdvisorState = {
      ...thread.advisor.state,
      status: "reviewing",
      correctionAttempts,
      activeTurnId: turnId,
      blockers: priorBlockers,
      error: null,
      updatedAt: createdAt,
    };
    yield* setState(thread.id, reviewingState).pipe(
      Effect.mapError(
        (cause) =>
          new AdvisorReviewError({
            threadId: input.threadId,
            stage: input.stage,
            detail: "Could not persist the in-progress review state.",
            cause,
          }),
      ),
    );

    const originalTask =
      thread.messages
        .toReversed()
        .find(
          (message) => message.role === "user" && !message.id.startsWith(CORRECTION_MESSAGE_PREFIX),
        )?.text ?? "[original request unavailable]";
    const evidence = yield* buildEvidence(thread, turnId).pipe(
      Effect.mapError(
        (cause) =>
          new AdvisorReviewError({
            threadId: input.threadId,
            stage: input.stage,
            detail: "Could not build the bounded evidence package.",
            cause,
          }),
      ),
    );
    const { prompt } = buildAdvisorReviewPrompt({
      stage: input.stage,
      task: originalTask,
      workerSummary: input.workerSummary,
      evidence,
      priorBlockers,
      attempt: correctionAttempts,
    });

    const generated = yield* Effect.scoped(
      Effect.gen(function* () {
        const isolatedCwd = yield* fileSystem.makeTempDirectoryScoped({
          prefix: `t3-advisor-${thread.id}-`,
        });
        return yield* textGeneration.generateAdvisorReview({
          cwd: isolatedCwd,
          prompt,
          modelSelection: thread.advisor!.config.modelSelection,
        });
      }),
    ).pipe(
      Effect.retry({ times: 1 }),
      Effect.mapError(
        (cause) =>
          new AdvisorReviewError({
            threadId: input.threadId,
            stage: input.stage,
            detail: "The selected orchestrator failed twice or returned malformed output.",
            cause,
          }),
      ),
      Effect.tapError((error) =>
        Effect.gen(function* () {
          const failedAt = yield* nowIso;
          yield* setState(thread.id, {
            ...reviewingState,
            status: "waiting_for_input",
            error: error.detail,
            updatedAt: failedAt,
          }).pipe(Effect.catch(() => Effect.void));
          yield* appendActivity({
            threadId: thread.id,
            turnId,
            tone: "error",
            kind: "advisor.outage",
            summary: "Orchestrator review needs attention",
            payload: { stage: input.stage, detail: error.detail },
            createdAt: failedAt,
          }).pipe(Effect.catch(() => Effect.void));
        }),
      ),
    );

    const reconciledBlockers = yield* reconcileBlockers(priorBlockers, generated.blockers).pipe(
      Effect.mapError(
        (cause) =>
          new AdvisorReviewError({
            threadId: input.threadId,
            stage: input.stage,
            detail: "Could not assign durable blocker identifiers.",
            cause,
          }),
      ),
    );
    const blockers = missingInitialCheckpoint
      ? reconciledBlockers.map((blocker) =>
          blocker.requirement === INITIAL_CHECKPOINT_BLOCKER
            ? { ...blocker, status: "open" as const }
            : blocker,
        )
      : reconciledBlockers;
    const openBlockers = blockers.filter((blocker) => blocker.status === "open");
    const transition = resolveReviewTransition({
      stage: input.stage,
      verdict: generated.verdict,
      openBlockerCount: openBlockers.length,
      correctionAttempts,
      maxCorrectionAttempts: thread.advisor.config.maxCorrectionAttempts,
    });
    const verdict = transition.verdict;
    const completedAt = yield* nowIso;
    const reviewId = yield* newEventId.pipe(
      Effect.mapError(
        (cause) =>
          new AdvisorReviewError({
            threadId: input.threadId,
            stage: input.stage,
            detail: "Could not assign a durable review identifier.",
            cause,
          }),
      ),
    );
    const review: OrchestrationAdvisorReview = {
      id: reviewId,
      turnId,
      stage: input.stage,
      verdict,
      summary: generated.summary.trim() || "Advisor review completed.",
      ...(generated.instruction?.trim() ? { instruction: generated.instruction.trim() } : {}),
      evidenceSummary: generated.evidenceSummary.trim() || "Evidence reviewed.",
      blockers,
      attempt: correctionAttempts,
      createdAt,
      completedAt,
    };

    const status = transition.status;
    const nextCorrectionAttempts = transition.correctionAttempts;

    const nextState: OrchestrationAdvisorState = {
      status,
      correctionAttempts: nextCorrectionAttempts,
      activeTurnId: turnId,
      blockers,
      lastReview: review,
      error:
        status === "waiting_for_input" && verdict !== "need_human" ? CORRECTION_LIMIT_ERROR : null,
      updatedAt: completedAt,
    };
    yield* setState(thread.id, nextState).pipe(
      Effect.mapError(
        (cause) =>
          new AdvisorReviewError({
            threadId: input.threadId,
            stage: input.stage,
            detail: "Could not persist the completed review.",
            cause,
          }),
      ),
    );
    yield* appendActivity({
      threadId: thread.id,
      turnId,
      tone: status === "waiting_for_input" ? "error" : "info",
      kind: "advisor.review",
      summary: `${input.stage} review: ${verdict}`,
      payload: {
        review,
        modelSelection: thread.advisor.config.modelSelection,
        status,
      },
      createdAt: completedAt,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new AdvisorReviewError({
            threadId: input.threadId,
            stage: input.stage,
            detail: "Could not persist the review activity.",
            cause,
          }),
      ),
    );
    if (status === "correcting") {
      yield* dispatchCorrectionTurn(thread, review).pipe(
        Effect.mapError(
          (cause) =>
            new AdvisorReviewError({
              threadId: input.threadId,
              stage: input.stage,
              detail: "Could not start the corrective worker turn.",
              cause,
            }),
        ),
      );
    }
    return review;
  });

  const consult: AdvisorReviewReactorShape["consult"] = (input) =>
    reviewLock.withPermit(
      Effect.gen(function* () {
        const cancellation = yield* Deferred.make<void>();
        activeReviewCancellations.set(input.threadId, cancellation);
        return yield* Effect.raceFirst(
          consultUnlocked(input),
          Deferred.await(cancellation).pipe(
            Effect.andThen(
              Effect.fail(
                new AdvisorReviewError({
                  threadId: input.threadId,
                  stage: input.stage,
                  detail: "The orchestrator review was cancelled by user interruption.",
                }),
              ),
            ),
          ),
        ).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (activeReviewCancellations.get(input.threadId) === cancellation) {
                activeReviewCancellations.delete(input.threadId);
              }
            }),
          ),
        );
      }),
    );

  const cancelActiveReview = (threadId: ThreadId) => {
    const cancellation = activeReviewCancellations.get(threadId);
    return cancellation
      ? Deferred.succeed(cancellation, undefined).pipe(Effect.asVoid)
      : Effect.void;
  };

  const handleAction = Effect.fn("AdvisorReview.handleAction")(function* (
    event: Extract<OrchestrationEvent, { type: "thread.advisor-response-requested" }>,
  ) {
    const thread = yield* getThread(event.payload.threadId);
    if (!thread?.advisor) return;
    const turnId = thread.advisor.state.activeTurnId ?? thread.latestTurn?.turnId;
    if (event.payload.action === "retry" && turnId) {
      if (
        thread.advisor.state.error === CORRECTION_LIMIT_ERROR &&
        thread.advisor.state.lastReview
      ) {
        const updatedAt = yield* nowIso;
        yield* setState(thread.id, {
          ...thread.advisor.state,
          status: "correcting",
          error: null,
          updatedAt,
        });
        yield* dispatchCorrectionTurn(thread, thread.advisor.state.lastReview);
        return;
      }
      yield* consult({
        threadId: thread.id,
        turnId,
        stage: "final",
        workerSummary: "User requested another final orchestrator review.",
        force: true,
      });
      return;
    }
    const updatedAt = yield* nowIso;
    if (event.payload.action === "bypass") {
      const waived = thread.advisor.state.blockers.map((blocker) => ({
        ...blocker,
        status: blocker.status === "open" ? ("waived" as const) : blocker.status,
      }));
      yield* setState(thread.id, {
        ...thread.advisor.state,
        status: "approved",
        blockers: waived,
        lastReview: thread.advisor.state.lastReview
          ? { ...thread.advisor.state.lastReview, blockers: waived }
          : null,
        error: null,
        updatedAt,
      });
      yield* appendActivity({
        threadId: thread.id,
        turnId: turnId ?? null,
        tone: "info",
        kind: "advisor.bypassed",
        summary: "Orchestrator blockers bypassed once",
        payload: {
          waivedBy: "user",
          blockerIds: waived.filter((blocker) => blocker.status === "waived").map((b) => b.id),
        },
        createdAt: updatedAt,
      });
      return;
    }
    yield* setState(thread.id, {
      ...thread.advisor.state,
      status: "stopped",
      error: null,
      updatedAt,
    });
  });

  const processInput = Effect.fn("AdvisorReview.processInput")(function* (input: ReactorInput) {
    if (input.type === "thread.advisor-response-requested") {
      yield* handleAction(input);
      return;
    }
    if (input.type === "thread.turn-interrupt-requested") {
      const thread = yield* getThread(input.payload.threadId);
      if (!thread?.advisor) return;
      const updatedAt = yield* nowIso;
      yield* setState(thread.id, {
        ...thread.advisor.state,
        status: "stopped",
        error: null,
        updatedAt,
      });
      return;
    }
    const threadId = input.type === "restart.review" ? input.threadId : input.payload.threadId;
    const turnId = input.type === "restart.review" ? input.turnId : input.payload.turnId;
    const thread = yield* getThread(threadId);
    if (!thread?.advisor || thread.latestTurn?.state === "interrupted") return;
    const existingReview = reviewFromActivity(thread, turnId, "final");
    if (existingReview) {
      if (
        thread.advisor.state.status === "correcting" &&
        !hasCorrectionMessage(thread.messages, existingReview)
      ) {
        yield* dispatchCorrectionTurn(thread, existingReview);
      }
      return;
    }
    if (input.type === "thread.turn-diff-completed" && input.payload.status === "missing") {
      yield* Effect.sleep("150 millis");
    }
    yield* consult({
      threadId,
      turnId,
      stage: "final",
      workerSummary: "Worker turn ended. Review the captured checkpoint and verification evidence.",
    });
  });

  const worker = yield* makeDrainableWorker((input: ReactorInput) =>
    processInput(input).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
        return Effect.logWarning("advisor review reactor failed", {
          type: input.type,
          cause: Cause.pretty(cause),
        });
      }),
    ),
  );

  const start: AdvisorReviewReactorShape["start"] = Effect.fn("AdvisorReview.start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(engine.streamDomainEvents, (event) => {
        if (
          event.type !== "thread.turn-diff-completed" &&
          event.type !== "thread.advisor-response-requested" &&
          event.type !== "thread.turn-interrupt-requested"
        ) {
          return Effect.void;
        }
        return event.type === "thread.turn-interrupt-requested"
          ? cancelActiveReview(event.payload.threadId).pipe(Effect.andThen(worker.enqueue(event)))
          : worker.enqueue(event);
      }),
    );

    const shell = yield* query.getShellSnapshot().pipe(Effect.orElseSucceed(() => null));
    if (!shell) return;
    for (const thread of shell.threads) {
      const turnId = thread.latestTurn?.turnId;
      if (!thread.advisor || !turnId || thread.latestTurn?.state !== "completed") continue;
      if (
        thread.advisor.state.status === "waiting_for_input" &&
        thread.advisor.state.error !== null &&
        !(
          thread.advisor.state.lastReview?.turnId === turnId &&
          thread.advisor.state.lastReview.stage === "final"
        )
      ) {
        continue;
      }
      yield* worker.enqueue({ type: "restart.review", threadId: thread.id, turnId });
    }
  });

  return {
    consult,
    start,
    drain: worker.drain,
  } satisfies AdvisorReviewReactorShape;
});

export const AdvisorReviewReactorLive = Layer.effect(AdvisorReviewReactor, make);
