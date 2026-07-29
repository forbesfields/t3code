// @effect-diagnostics nodeBuiltinImport:off
import { describe, expect, it } from "@effect/vitest";
import * as NodeURL from "node:url";

import { AntigravitySettings, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { makeAntigravityAdapter } from "./AntigravityAdapter.ts";

const fixture = NodeURL.fileURLToPath(new URL("./fixtures/fake-agy.mjs", import.meta.url));
const settings = Schema.decodeSync(AntigravitySettings)({ binaryPath: fixture });

describe("AntigravityAdapter", () => {
  it.effect("maps stream-json output and resumes the Antigravity conversation", () =>
    Effect.gen(function* () {
      const adapter = yield* makeAntigravityAdapter(settings, {
        instanceId: ProviderInstanceId.make("antigravity"),
      });
      const threadId = ThreadId.make("antigravity-lifecycle-test");
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId,
        cwd: process.cwd(),
        runtimeMode: "full-access",
        resumeCursor: { schemaVersion: 1, conversationId: "agy-resume" },
        modelSelection: {
          instanceId: ProviderInstanceId.make("antigravity"),
          model: "gemini-3.6-flash-high",
        },
      });
      expect(session.status).toBe("ready");

      const turn = yield* adapter.sendTurn({ threadId, input: "Say hello" });
      expect(turn.resumeCursor).toEqual({
        schemaVersion: 1,
        conversationId: "agy-resume",
      });

      const events = Array.from(yield* Fiber.join(eventsFiber));
      expect(events.map((event) => event.type)).toEqual(
        expect.arrayContaining([
          "session.started",
          "turn.started",
          "item.started",
          "content.delta",
          "item.completed",
          "turn.completed",
        ]),
      );
      expect(
        events
          .filter((event) => event.type === "content.delta")
          .map((event) => event.payload.delta)
          .join(""),
      ).toBe("Hello from Antigravity");
      expect(
        events.find(
          (event) =>
            event.type === "item.started" && event.payload.itemType === "dynamic_tool_call",
        ),
      ).toBeDefined();
    }).pipe(Effect.scoped),
  );
});
