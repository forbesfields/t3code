// @effect-diagnostics globalDate:off globalDateInEffect:off cryptoRandomUUID:off cryptoRandomUUIDInEffect:off outdatedApi:off
import {
  EventId,
  type PiSettings,
  type ProviderApprovalDecision,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  RuntimeItemId,
  RuntimeRequestId,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import {
  type ProviderAdapterError,
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { PiRpcProcess } from "./PiRpcProcess.ts";

const PROVIDER = ProviderDriverKind.make("pi");

interface PendingUiRequest {
  readonly method: string;
  readonly id: string;
}

interface PiSessionContext {
  readonly threadId: ThreadId;
  readonly client: PiRpcProcess;
  session: ProviderSession;
  activeTurnId: TurnId | undefined;
  readonly startedItems: Set<string>;
  readonly pendingUi: Map<string, PendingUiRequest>;
  turns: Array<{ id: TurnId; items: Array<unknown> }>;
  stopped: boolean;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function modelParts(model: string): { provider: string; modelId: string } | undefined {
  const separator = model.indexOf("/");
  if (separator <= 0 || separator === model.length - 1) return undefined;
  return { provider: model.slice(0, separator), modelId: model.slice(separator + 1) };
}

function toolItemType(toolName: string) {
  if (toolName === "bash") return "command_execution" as const;
  if (toolName === "edit" || toolName === "write") return "file_change" as const;
  return "dynamic_tool_call" as const;
}

function eventBase(
  context: PiSessionContext,
  input?: {
    readonly turnId?: TurnId;
    readonly itemId?: string;
    readonly requestId?: string;
    readonly raw?: Record<string, unknown>;
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
    ...(input?.requestId ? { requestId: RuntimeRequestId.make(input.requestId) } : {}),
    ...(input?.raw ? { raw: { source: "pi.jsonrpc" as const, payload: input.raw } } : {}),
    providerRefs: {},
  };
}

function contentText(value: unknown): string | undefined {
  const result = record(value);
  if (!result || !Array.isArray(result.content)) return undefined;
  return result.content
    .map((entry) => record(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== undefined)
    .map((entry) => (entry.type === "text" && typeof entry.text === "string" ? entry.text : ""))
    .filter(Boolean)
    .join("\n");
}

export function makePiAdapter(
  settings: PiSettings,
  options: {
    readonly instanceId: ProviderInstanceId;
    readonly environment?: NodeJS.ProcessEnv;
  },
) {
  return Effect.gen(function* () {
    const runtimeContext = yield* Effect.context<never>();
    const runFork = Effect.runForkWith(runtimeContext);
    const sessions = new Map<ThreadId, PiSessionContext>();
    const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();

    const emit = (event: ProviderRuntimeEvent) =>
      Queue.offer(runtimeEvents, event).pipe(Effect.asVoid);

    const requireSession = (
      threadId: ThreadId,
    ): Effect.Effect<PiSessionContext, ProviderAdapterSessionNotFoundError> =>
      Effect.suspend(() => {
        const context = sessions.get(threadId);
        return context
          ? Effect.succeed(context)
          : Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }));
      });

    const rpc = (context: PiSessionContext, command: Record<string, unknown>) =>
      Effect.tryPromise({
        try: () => context.client.request(command as { type: string }),
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: typeof command.type === "string" ? command.type : "rpc",
            detail: cause instanceof Error ? cause.message : "Pi JSON-RPC request failed",
            cause,
          }),
      });

    const completeTurn = (context: PiSessionContext, state: "completed" | "failed" = "completed") =>
      Effect.gen(function* () {
        const turnId = context.activeTurnId;
        if (!turnId) return;
        context.activeTurnId = undefined;
        const { activeTurnId: _activeTurnId, ...sessionWithoutActiveTurn } = context.session;
        context.session = {
          ...sessionWithoutActiveTurn,
          status: "ready",
          updatedAt: new Date().toISOString(),
        };
        yield* emit({
          ...eventBase(context, { turnId }),
          type: "turn.completed",
          payload: { state },
        });
      });

    const handleUiRequest = (context: PiSessionContext, event: Record<string, unknown>) =>
      Effect.gen(function* () {
        const id = typeof event.id === "string" ? event.id : undefined;
        const method = typeof event.method === "string" ? event.method : undefined;
        if (
          !id ||
          !method ||
          ["notify", "setStatus", "setWidget", "setTitle", "set_editor_text"].includes(method)
        )
          return;
        context.pendingUi.set(id, { id, method });
        const turnId = context.activeTurnId;
        if (method === "confirm") {
          const detail = [event.title, event.message]
            .filter(
              (value): value is string => typeof value === "string" && value.trim().length > 0,
            )
            .join("\n");
          yield* emit({
            ...eventBase(context, { ...(turnId ? { turnId } : {}), requestId: id, raw: event }),
            type: "request.opened",
            payload: {
              requestType: "dynamic_tool_call",
              ...(detail ? { detail } : {}),
              args: event,
            },
          });
          return;
        }

        const title =
          typeof event.title === "string" && event.title.trim()
            ? event.title.trim()
            : "Pi needs input";
        const options = Array.isArray(event.options)
          ? event.options.filter(
              (value): value is string => typeof value === "string" && value.trim().length > 0,
            )
          : [];
        yield* emit({
          ...eventBase(context, { ...(turnId ? { turnId } : {}), requestId: id, raw: event }),
          type: "user-input.requested",
          payload: {
            questions: [
              {
                id: "value",
                header: title,
                question:
                  typeof event.placeholder === "string" && event.placeholder.trim()
                    ? event.placeholder.trim()
                    : title,
                options: options.map((value) => ({ label: value, description: value })),
              },
            ],
          },
        });
      });

    const handleEvent = (context: PiSessionContext, event: Record<string, unknown>) =>
      Effect.gen(function* () {
        if (context.stopped) return;
        const type = typeof event.type === "string" ? event.type : "";
        if (type === "extension_ui_request") {
          yield* handleUiRequest(context, event);
          return;
        }
        const turnId = context.activeTurnId;
        if (!turnId) return;

        if (type === "message_update") {
          const assistantEvent = record(event.assistantMessageEvent);
          const updateType = typeof assistantEvent?.type === "string" ? assistantEvent.type : "";
          const contentIndex =
            typeof assistantEvent?.contentIndex === "number" ? assistantEvent.contentIndex : 0;
          const isThinking = updateType.startsWith("thinking_");
          const itemId = `${turnId}:${isThinking ? "thinking" : "assistant"}:${contentIndex}`;
          if (
            (updateType.endsWith("_start") || updateType.endsWith("_delta")) &&
            !context.startedItems.has(itemId)
          ) {
            context.startedItems.add(itemId);
            yield* emit({
              ...eventBase(context, { turnId, itemId, raw: event }),
              type: "item.started",
              payload: {
                itemType: isThinking ? "reasoning" : "assistant_message",
                status: "inProgress",
              },
            });
          }
          if (
            (updateType === "text_delta" || updateType === "thinking_delta") &&
            typeof assistantEvent?.delta === "string"
          ) {
            yield* emit({
              ...eventBase(context, { turnId, itemId, raw: event }),
              type: "content.delta",
              payload: {
                streamKind: isThinking ? "reasoning_text" : "assistant_text",
                delta: assistantEvent.delta,
                contentIndex,
              },
            });
          }
          if (updateType === "text_end" || updateType === "thinking_end") {
            yield* emit({
              ...eventBase(context, { turnId, itemId, raw: event }),
              type: "item.completed",
              payload: {
                itemType: isThinking ? "reasoning" : "assistant_message",
                status: "completed",
              },
            });
          }
          return;
        }

        if (type.startsWith("tool_execution_")) {
          const toolCallId =
            typeof event.toolCallId === "string"
              ? event.toolCallId
              : globalThis.crypto.randomUUID();
          const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
          const itemType = toolItemType(toolName);
          if (type === "tool_execution_start") {
            context.startedItems.add(toolCallId);
            yield* emit({
              ...eventBase(context, { turnId, itemId: toolCallId, raw: event }),
              type: "item.started",
              payload: { itemType, status: "inProgress", title: toolName, data: event.args },
            });
          } else if (type === "tool_execution_update") {
            yield* emit({
              ...eventBase(context, { turnId, itemId: toolCallId, raw: event }),
              type: "item.updated",
              payload: {
                itemType,
                status: "inProgress",
                title: toolName,
                ...(contentText(event.partialResult)
                  ? { detail: contentText(event.partialResult) }
                  : {}),
                data: event.partialResult,
              },
            });
          } else {
            const failed = event.isError === true;
            yield* emit({
              ...eventBase(context, { turnId, itemId: toolCallId, raw: event }),
              type: "item.completed",
              payload: {
                itemType,
                status: failed ? "failed" : "completed",
                title: toolName,
                ...(contentText(event.result) ? { detail: contentText(event.result) } : {}),
                data: event.result,
              },
            });
          }
          return;
        }

        if (type === "agent_settled") {
          yield* completeTurn(context);
        }
      });

    const startSession: ProviderAdapterShape<ProviderAdapterError>["startSession"] = Effect.fn(
      "PiAdapter.startSession",
    )(function* (input) {
      const existing = sessions.get(input.threadId);
      if (existing) {
        existing.stopped = true;
        existing.client.close();
        sessions.delete(input.threadId);
      }
      const now = new Date().toISOString();
      let context!: PiSessionContext;
      const args = ["--session-id", input.threadId, "--approve"];
      const client = new PiRpcProcess({
        binaryPath: settings.binaryPath,
        cwd: input.cwd ?? process.cwd(),
        args,
        env: {
          ...process.env,
          ...options.environment,
          PI_CODING_AGENT_DIR: settings.agentDir,
        },
        onEvent: (event) => {
          if (context) runFork(handleEvent(context, event));
        },
        onExit: (detail) => {
          if (!context || context.stopped) return;
          context.stopped = true;
          context.session = {
            ...context.session,
            status: "error",
            lastError: detail,
            updatedAt: new Date().toISOString(),
          };
          runFork(
            emit({
              ...eventBase(context),
              type: "session.exited",
              payload: { reason: detail, recoverable: true, exitKind: "error" },
            }),
          );
        },
      });
      const session: ProviderSession = {
        provider: PROVIDER,
        providerInstanceId: options.instanceId,
        status: "connecting",
        runtimeMode: input.runtimeMode,
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
        threadId: input.threadId,
        resumeCursor: { schemaVersion: 1, sessionId: input.threadId },
        createdAt: now,
        updatedAt: now,
      };
      context = {
        threadId: input.threadId,
        client,
        session,
        activeTurnId: undefined,
        startedItems: new Set(),
        pendingUi: new Map(),
        turns: [],
        stopped: false,
      };
      sessions.set(input.threadId, context);

      yield* rpc(context, { type: "get_state" }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterProcessError({
              provider: PROVIDER,
              threadId: input.threadId,
              detail: cause.message,
              cause,
            }),
        ),
      );
      if (input.modelSelection?.model) {
        const selected = modelParts(input.modelSelection.model);
        if (selected) yield* rpc(context, { type: "set_model", ...selected });
      }
      context.session = {
        ...context.session,
        status: "ready",
        updatedAt: new Date().toISOString(),
      };
      yield* emit({
        ...eventBase(context),
        type: "session.started",
        payload: { resume: context.session.resumeCursor },
      });
      yield* emit({
        ...eventBase(context),
        type: "session.configured",
        payload: { config: { cwd: input.cwd ?? process.cwd(), agentDir: settings.agentDir } },
      });
      yield* emit({
        ...eventBase(context),
        type: "session.state.changed",
        payload: { state: "ready" },
      });
      return { ...context.session };
    });

    const sendTurn: ProviderAdapterShape<ProviderAdapterError>["sendTurn"] = Effect.fn(
      "PiAdapter.sendTurn",
    )(function* (input) {
      const context = yield* requireSession(input.threadId);
      const message = input.input?.trim();
      if (!message) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "Pi turns require a text prompt.",
        });
      }
      if (input.modelSelection?.model && input.modelSelection.model !== context.session.model) {
        const selected = modelParts(input.modelSelection.model);
        if (!selected) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "set_model",
            issue: `Pi model '${input.modelSelection.model}' is not provider-qualified.`,
          });
        }
        yield* rpc(context, { type: "set_model", ...selected });
        context.session = { ...context.session, model: input.modelSelection.model };
      }
      const existingTurn = context.activeTurnId;
      const turnId = existingTurn ?? TurnId.make(globalThis.crypto.randomUUID());
      if (!existingTurn) {
        context.activeTurnId = turnId;
        context.turns.push({ id: turnId, items: [] });
        context.session = {
          ...context.session,
          status: "running",
          activeTurnId: turnId,
          updatedAt: new Date().toISOString(),
        };
        yield* emit({
          ...eventBase(context, { turnId }),
          type: "turn.started",
          payload: input.modelSelection?.model ? { model: input.modelSelection.model } : {},
        });
      }
      yield* rpc(context, {
        type: "prompt",
        message,
        ...(existingTurn ? { streamingBehavior: "steer" } : {}),
      });
      return {
        threadId: input.threadId,
        turnId,
        resumeCursor: context.session.resumeCursor,
      };
    });

    const interruptTurn: ProviderAdapterShape<ProviderAdapterError>["interruptTurn"] = Effect.fn(
      "PiAdapter.interruptTurn",
    )(function* (threadId) {
      const context = yield* requireSession(threadId);
      yield* rpc(context, { type: "abort" });
      const turnId = context.activeTurnId;
      if (turnId) {
        context.activeTurnId = undefined;
        const { activeTurnId: _activeTurnId, ...sessionWithoutActiveTurn } = context.session;
        context.session = {
          ...sessionWithoutActiveTurn,
          status: "ready",
          updatedAt: new Date().toISOString(),
        };
        yield* emit({
          ...eventBase(context, { turnId }),
          type: "turn.aborted",
          payload: { reason: "Interrupted by user" },
        });
      }
    });

    const respondToRequest: ProviderAdapterShape<ProviderAdapterError>["respondToRequest"] =
      Effect.fn("PiAdapter.respondToRequest")(function* (
        threadId,
        requestId,
        decision: ProviderApprovalDecision,
      ) {
        const context = yield* requireSession(threadId);
        const pending = context.pendingUi.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "extension_ui_response",
            detail: `Unknown Pi UI request ${requestId}`,
          });
        }
        context.pendingUi.delete(requestId);
        context.client.notify({
          type: "extension_ui_response",
          id: pending.id,
          ...(decision === "cancel"
            ? { cancelled: true }
            : { confirmed: decision === "accept" || decision === "acceptForSession" }),
        });
        yield* emit({
          ...eventBase(context, {
            ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
            requestId,
            raw: { decision },
          }),
          type: "request.resolved",
          payload: { requestType: "dynamic_tool_call", decision },
        });
      });

    const respondToUserInput: ProviderAdapterShape<ProviderAdapterError>["respondToUserInput"] =
      Effect.fn("PiAdapter.respondToUserInput")(function* (threadId, requestId, answers) {
        const context = yield* requireSession(threadId);
        const pending = context.pendingUi.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "extension_ui_response",
            detail: `Unknown Pi UI request ${requestId}`,
          });
        }
        context.pendingUi.delete(requestId);
        const first = Object.values(answers)[0];
        const value = Array.isArray(first) ? first[0] : first;
        context.client.notify(
          value === undefined || value === null
            ? { type: "extension_ui_response", id: pending.id, cancelled: true }
            : { type: "extension_ui_response", id: pending.id, value: String(value) },
        );
        yield* emit({
          ...eventBase(context, {
            ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
            requestId,
            raw: { answers },
          }),
          type: "user-input.resolved",
          payload: { answers },
        });
      });

    const stopSessionInternal = (context: PiSessionContext, emitExit: boolean) =>
      Effect.gen(function* () {
        if (context.stopped) return;
        context.stopped = true;
        context.client.close();
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
      respondToRequest,
      respondToUserInput,
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
