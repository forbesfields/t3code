// @effect-diagnostics globalDate:off globalDateInEffect:off cryptoRandomUUID:off cryptoRandomUUIDInEffect:off nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeReadline from "node:readline";

import {
  type AntigravitySettings,
  EventId,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderSession,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeItemId,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import {
  type ProviderAdapterError,
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";

const PROVIDER = ProviderDriverKind.make("antigravity");
const RESUME_SCHEMA_VERSION = 1 as const;

const StepUpdate = Schema.Struct({
  conversation_id: Schema.optional(Schema.String),
  step_index: Schema.Number,
  state: Schema.String,
  step_type: Schema.String,
  text_delta: Schema.optional(Schema.String),
  tool_name: Schema.optional(Schema.String),
  tool_info: Schema.optional(Schema.Unknown),
});

const AntigravityStreamEvent = Schema.Struct({
  event: Schema.String,
  conversation_id: Schema.optional(Schema.String),
  init: Schema.optional(Schema.Unknown),
  step_update: Schema.optional(StepUpdate),
  result: Schema.optional(
    Schema.Struct({
      conversation_id: Schema.optional(Schema.String),
      status: Schema.String,
      response: Schema.optional(Schema.String),
    }),
  ),
});
type AntigravityStreamEvent = typeof AntigravityStreamEvent.Type;

const decodeStreamEvent = Schema.decodeUnknownOption(Schema.fromJsonString(AntigravityStreamEvent));

interface AntigravityResumeCursor {
  readonly schemaVersion: typeof RESUME_SCHEMA_VERSION;
  readonly conversationId: string;
}

interface AntigravitySessionContext {
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly approvalPolicy: ProviderSession["runtimeMode"];
  readonly sandboxMode: string | undefined;
  session: ProviderSession;
  conversationId: string | undefined;
  activeTurnId: TurnId | undefined;
  activeProcess: NodeChildProcess.ChildProcessWithoutNullStreams | undefined;
  turns: Array<{ id: TurnId; items: Array<unknown> }>;
  readonly startedItems: Set<string>;
  stopped: boolean;
}

function parseResumeCursor(value: unknown): AntigravityResumeCursor | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const cursor = value as Record<string, unknown>;
  if (cursor.schemaVersion !== RESUME_SCHEMA_VERSION) return undefined;
  if (typeof cursor.conversationId !== "string" || !cursor.conversationId.trim()) return undefined;
  return {
    schemaVersion: RESUME_SCHEMA_VERSION,
    conversationId: cursor.conversationId.trim(),
  };
}

function resumeCursor(conversationId: string | undefined): AntigravityResumeCursor | undefined {
  return conversationId ? { schemaVersion: RESUME_SCHEMA_VERSION, conversationId } : undefined;
}

function toolItemType(toolName: string) {
  const normalized = toolName.toLowerCase();
  if (
    normalized.includes("command") ||
    normalized.includes("shell") ||
    normalized.includes("terminal")
  ) {
    return "command_execution" as const;
  }
  if (
    normalized.includes("write") ||
    normalized.includes("edit") ||
    normalized.includes("replace") ||
    normalized.includes("delete") ||
    normalized.includes("create")
  ) {
    return "file_change" as const;
  }
  if (normalized.includes("subagent") || normalized.includes("agent")) {
    return "collab_agent_tool_call" as const;
  }
  if (normalized.includes("mcp")) return "mcp_tool_call" as const;
  if (normalized.includes("web") || normalized.includes("browser")) return "web_search" as const;
  if (normalized.includes("image") || normalized.includes("screenshot")) {
    return "image_view" as const;
  }
  return "dynamic_tool_call" as const;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function eventBase(
  context: AntigravitySessionContext,
  input?: {
    readonly turnId?: TurnId;
    readonly itemId?: string;
    readonly raw?: AntigravityStreamEvent;
  },
) {
  return {
    eventId: EventId.make(globalThis.crypto.randomUUID()),
    provider: PROVIDER,
    providerInstanceId: context.session.providerInstanceId,
    threadId: context.threadId,
    createdAt: new Date().toISOString(),
    ...(input?.turnId ? { turnId: input.turnId } : {}),
    ...(input?.itemId ? { itemId: RuntimeItemId.make(input.itemId) } : {}),
    ...(input?.raw
      ? {
          raw: {
            source: "antigravity.stream-json" as const,
            payload: input.raw,
          },
        }
      : {}),
    providerRefs: {},
  };
}

export function makeAntigravityAdapter(
  settings: AntigravitySettings,
  options: {
    readonly instanceId: ProviderInstanceId;
    readonly environment?: NodeJS.ProcessEnv;
    readonly attachmentsDir?: string;
  },
) {
  return Effect.gen(function* () {
    const runtimeContext = yield* Effect.context<never>();
    const runFork = Effect.runForkWith(runtimeContext);
    const sessions = new Map<ThreadId, AntigravitySessionContext>();
    const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const emit = (event: ProviderRuntimeEvent) =>
      Queue.offer(runtimeEvents, event).pipe(Effect.asVoid);

    const requireSession = (
      threadId: ThreadId,
    ): Effect.Effect<AntigravitySessionContext, ProviderAdapterSessionNotFoundError> =>
      Effect.suspend(() => {
        const context = sessions.get(threadId);
        return context && !context.stopped
          ? Effect.succeed(context)
          : Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }));
      });

    const completeTurn = (
      context: AntigravitySessionContext,
      turnId: TurnId,
      state: "completed" | "failed",
    ) =>
      Effect.gen(function* () {
        if (context.activeTurnId !== turnId) return;
        context.activeTurnId = undefined;
        context.activeProcess = undefined;
        const { activeTurnId: _activeTurnId, ...session } = context.session;
        context.session = {
          ...session,
          status: "ready",
          updatedAt: new Date().toISOString(),
          ...(resumeCursor(context.conversationId)
            ? { resumeCursor: resumeCursor(context.conversationId) }
            : {}),
        };
        yield* emit({
          ...eventBase(context, { turnId }),
          type: "turn.completed",
          payload: { state },
        });
      });

    const handleEvent = (
      context: AntigravitySessionContext,
      turnId: TurnId,
      event: AntigravityStreamEvent,
    ) =>
      Effect.gen(function* () {
        const update = event.step_update;
        if (event.event === "step_update" && update) {
          const itemId = `${turnId}:${update.step_type}:${update.step_index}`;
          if (update.step_type === "agent_response" && update.text_delta !== undefined) {
            if (!context.startedItems.has(itemId)) {
              context.startedItems.add(itemId);
              yield* emit({
                ...eventBase(context, { turnId, itemId, raw: event }),
                type: "item.started",
                payload: { itemType: "assistant_message", status: "inProgress" },
              });
            }
            yield* emit({
              ...eventBase(context, { turnId, itemId, raw: event }),
              type: "content.delta",
              payload: {
                streamKind: "assistant_text",
                delta: update.text_delta,
                contentIndex: update.step_index,
              },
            });
            if (update.state === "DONE" || update.state === "ERROR") {
              yield* emit({
                ...eventBase(context, { turnId, itemId, raw: event }),
                type: "item.completed",
                payload: {
                  itemType: "assistant_message",
                  status: update.state === "ERROR" ? "failed" : "completed",
                },
              });
            }
            return;
          }

          if (update.step_type === "tool") {
            const toolName = update.tool_name?.trim() || "tool";
            const itemType = toolItemType(toolName);
            const toolInfo = record(update.tool_info);
            const data = toolInfo?.parameters ?? update.tool_info;
            if (!context.startedItems.has(itemId)) {
              context.startedItems.add(itemId);
              yield* emit({
                ...eventBase(context, { turnId, itemId, raw: event }),
                type: "item.started",
                payload: { itemType, status: "inProgress", title: toolName, data },
              });
            }
            if (update.state === "DONE" || update.state === "ERROR") {
              const error = record(toolInfo?.error);
              yield* emit({
                ...eventBase(context, { turnId, itemId, raw: event }),
                type: "item.completed",
                payload: {
                  itemType,
                  status: update.state === "ERROR" ? "failed" : "completed",
                  title: toolName,
                  ...(typeof error?.message === "string" ? { detail: error.message } : {}),
                  data,
                },
              });
            }
          }
          return;
        }

        if (event.event === "result" && event.result) {
          yield* completeTurn(
            context,
            turnId,
            event.result.status === "SUCCESS" ? "completed" : "failed",
          );
        }
      });

    const buildPrompt = (
      input: Parameters<ProviderAdapterShape<ProviderAdapterError>["sendTurn"]>[0],
    ) =>
      Effect.gen(function* () {
        const prompt = input.input?.trim();
        if (!prompt) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Antigravity turns require a text prompt.",
          });
        }
        if (!input.attachments?.length) return prompt;
        if (!options.attachmentsDir) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Antigravity attachments are unavailable without an attachment directory.",
          });
        }
        const paths = input.attachments.map((attachment) =>
          resolveAttachmentPath({ attachmentsDir: options.attachmentsDir!, attachment }),
        );
        if (paths.some((path) => path === null)) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "One or more Antigravity attachments could not be resolved.",
          });
        }
        return `${prompt}\n\nAttachments:\n${paths.map((path) => `@${path}`).join("\n")}`;
      });

    const startSession: ProviderAdapterShape<ProviderAdapterError>["startSession"] = Effect.fn(
      "AntigravityAdapter.startSession",
    )(function* (input) {
      const existing = sessions.get(input.threadId);
      if (existing) {
        existing.stopped = true;
        existing.activeProcess?.kill();
        sessions.delete(input.threadId);
      }
      const cwd = input.cwd?.trim();
      if (!cwd) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: "cwd is required and must be non-empty.",
        });
      }
      const now = new Date().toISOString();
      const cursor = parseResumeCursor(input.resumeCursor);
      const session: ProviderSession = {
        provider: PROVIDER,
        providerInstanceId: options.instanceId,
        status: "ready",
        runtimeMode: input.runtimeMode,
        cwd,
        ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
        threadId: input.threadId,
        ...(cursor ? { resumeCursor: cursor } : {}),
        createdAt: now,
        updatedAt: now,
      };
      const context: AntigravitySessionContext = {
        threadId: input.threadId,
        cwd,
        approvalPolicy: input.runtimeMode,
        sandboxMode: input.sandboxMode,
        session,
        conversationId: cursor?.conversationId,
        activeTurnId: undefined,
        activeProcess: undefined,
        turns: [],
        startedItems: new Set(),
        stopped: false,
      };
      sessions.set(input.threadId, context);
      yield* emit({
        ...eventBase(context),
        type: "session.started",
        payload: cursor ? { resume: cursor } : {},
      });
      yield* emit({
        ...eventBase(context),
        type: "session.configured",
        payload: { config: { cwd, binaryPath: settings.binaryPath } },
      });
      yield* emit({
        ...eventBase(context),
        type: "session.state.changed",
        payload: { state: "ready" },
      });
      return { ...session };
    });

    const sendTurn: ProviderAdapterShape<ProviderAdapterError>["sendTurn"] = Effect.fn(
      "AntigravityAdapter.sendTurn",
    )(function* (input) {
      const context = yield* requireSession(input.threadId);
      if (context.activeProcess) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "Antigravity is still running the previous turn.",
        });
      }
      const prompt = yield* buildPrompt(input);
      const model = input.modelSelection?.model ?? context.session.model;
      const turnId = TurnId.make(globalThis.crypto.randomUUID());
      const args = ["--output-format", "stream-json", "--print-timeout", "24h"];
      if (model) args.push("--model", model);
      if (context.conversationId) args.push("--conversation", context.conversationId);
      if (input.interactionMode === "plan") {
        args.push("--mode", "plan");
      } else if (context.approvalPolicy === "auto-accept-edits") {
        args.push("--mode", "accept-edits");
      }
      if (context.approvalPolicy === "full-access" || context.approvalPolicy === "auto") {
        args.push("--dangerously-skip-permissions");
      }
      if (context.sandboxMode === "read-only") args.push("--sandbox");
      args.push("--print", prompt);

      const child = NodeChildProcess.spawn(settings.binaryPath, args, {
        cwd: context.cwd,
        env: { ...process.env, ...options.environment },
        stdio: ["pipe", "pipe", "pipe"],
      });
      child.stdin.end();
      context.activeProcess = child;
      context.activeTurnId = turnId;
      context.turns.push({ id: turnId, items: [] });
      context.session = {
        ...context.session,
        status: "running",
        activeTurnId: turnId,
        ...(model ? { model } : {}),
        updatedAt: new Date().toISOString(),
      };
      yield* emit({
        ...eventBase(context, { turnId }),
        type: "turn.started",
        payload: model ? { model } : {},
      });

      let stderr = "";
      let sawResult = false;
      let initSettled = false;
      let resolveInit!: () => void;
      let rejectInit!: (cause: Error) => void;
      const init = new Promise<void>((resolve, reject) => {
        resolveInit = resolve;
        rejectInit = reject;
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      const lines = NodeReadline.createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        const decoded = Option.getOrUndefined(decodeStreamEvent(line));
        if (!decoded) return;
        const conversationId =
          decoded.conversation_id ??
          decoded.step_update?.conversation_id ??
          decoded.result?.conversation_id;
        if (conversationId?.trim()) {
          context.conversationId = conversationId.trim();
          context.session = {
            ...context.session,
            resumeCursor: resumeCursor(context.conversationId),
          };
        }
        if (decoded.event === "init" && !initSettled) {
          initSettled = true;
          resolveInit();
        }
        if (decoded.event === "result") sawResult = true;
        runFork(handleEvent(context, turnId, decoded));
      });
      child.once("error", (cause) => {
        if (!initSettled) {
          initSettled = true;
          rejectInit(cause);
        }
      });
      child.once("close", (code, signal) => {
        lines.close();
        if (!initSettled) {
          initSettled = true;
          rejectInit(
            new Error(stderr.trim() || `agy exited before initialization (${code ?? signal})`),
          );
        }
        if (sawResult || context.activeTurnId !== turnId) return;
        runFork(
          Effect.gen(function* () {
            yield* emit({
              ...eventBase(context, { turnId }),
              type: "session.state.changed",
              payload: {
                state: "error",
                detail: stderr.trim() || `agy exited with code ${code ?? "unknown"}.`,
              },
            });
            yield* completeTurn(context, turnId, "failed");
          }),
        );
      });

      yield* Effect.tryPromise({
        try: () => init,
        catch: (cause) =>
          new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId: input.threadId,
            detail: cause instanceof Error ? cause.message : "Antigravity failed to start.",
            cause,
          }),
      }).pipe(
        Effect.onError(() =>
          Effect.sync(() => {
            child.kill();
            context.activeProcess = undefined;
            context.activeTurnId = undefined;
          }),
        ),
      );

      return {
        threadId: input.threadId,
        turnId,
        ...(resumeCursor(context.conversationId)
          ? { resumeCursor: resumeCursor(context.conversationId) }
          : {}),
      };
    });

    const interruptTurn: ProviderAdapterShape<ProviderAdapterError>["interruptTurn"] = Effect.fn(
      "AntigravityAdapter.interruptTurn",
    )(function* (threadId) {
      const context = yield* requireSession(threadId);
      const turnId = context.activeTurnId;
      if (!turnId) return;
      context.activeProcess?.kill("SIGTERM");
      context.activeProcess = undefined;
      context.activeTurnId = undefined;
      const { activeTurnId: _activeTurnId, ...session } = context.session;
      context.session = { ...session, status: "ready", updatedAt: new Date().toISOString() };
      yield* emit({
        ...eventBase(context, { turnId }),
        type: "turn.aborted",
        payload: { reason: "Interrupted by user" },
      });
    });

    const unsupportedRequest = (
      method: string,
      _threadId: ThreadId,
      _requestId: string,
      _value: ProviderApprovalDecision | Record<string, unknown>,
    ) =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method,
          detail: "Antigravity headless mode does not expose interactive request responses.",
        }),
      );

    const stopSessionInternal = (context: AntigravitySessionContext, emitExit: boolean) =>
      Effect.gen(function* () {
        if (context.stopped) return;
        context.stopped = true;
        context.activeProcess?.kill("SIGTERM");
        context.activeProcess = undefined;
        context.session = {
          ...context.session,
          status: "closed",
          updatedAt: new Date().toISOString(),
        };
        sessions.delete(context.threadId);
        if (emitExit) {
          yield* emit({
            ...eventBase(context),
            type: "session.exited",
            payload: { reason: "Session stopped", recoverable: true, exitKind: "graceful" },
          });
        }
      });

    const adapter: ProviderAdapterShape<ProviderAdapterError> = {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "in-session" },
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest: (threadId, requestId, decision) =>
        unsupportedRequest("respondToRequest", threadId, requestId, decision),
      respondToUserInput: (threadId, requestId, answers) =>
        unsupportedRequest("respondToUserInput", threadId, requestId, answers),
      stopSession: (threadId) =>
        requireSession(threadId).pipe(
          Effect.flatMap((context) => stopSessionInternal(context, true)),
        ),
      listSessions: () =>
        Effect.sync(() => [...sessions.values()].map((context) => ({ ...context.session }))),
      hasSession: (threadId) => Effect.sync(() => sessions.has(threadId)),
      readThread: (threadId) =>
        requireSession(threadId).pipe(
          Effect.map((context) => ({ threadId, turns: context.turns })),
        ),
      rollbackThread: (threadId, numTurns) =>
        requireSession(threadId).pipe(
          Effect.map((context) => {
            context.turns.splice(Math.max(0, context.turns.length - numTurns));
            return { threadId, turns: context.turns };
          }),
        ),
      stopAll: () =>
        Effect.forEach([...sessions.values()], (context) => stopSessionInternal(context, true), {
          discard: true,
        }),
      get streamEvents() {
        return Stream.fromQueue(runtimeEvents);
      },
    };

    yield* Effect.addFinalizer(() =>
      Effect.forEach([...sessions.values()], (context) => stopSessionInternal(context, false), {
        discard: true,
      }).pipe(Effect.tap(() => Queue.shutdown(runtimeEvents))),
    );

    return adapter;
  });
}
