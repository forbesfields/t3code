import { describe, expect, it } from "@effect/vitest";
import * as NodeURL from "node:url";

import { PiSettings, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { makePiAdapter } from "./PiAdapter.ts";

const fixture = NodeURL.fileURLToPath(new URL("./fixtures/fake-pi-rpc.mjs", import.meta.url));
const settings = Schema.decodeSync(PiSettings)({
  binaryPath: fixture,
  agentDir: "/tmp/fake-pi-agent",
});

describe("PiAdapter", () => {
  it.effect("maps a Pi JSON-RPC turn into canonical streaming events", () =>
    Effect.gen(function* () {
      const adapter = yield* makePiAdapter(settings, {
        instanceId: ProviderInstanceId.make("pi"),
      });
      const threadId = ThreadId.make("pi-lifecycle-test");
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId,
        cwd: process.cwd(),
        runtimeMode: "full-access",
        modelSelection: { instanceId: ProviderInstanceId.make("pi"), model: "openai/gpt-5" },
      });
      expect(session.status).toBe("ready");
      yield* adapter.sendTurn({ threadId, input: "Say hello" });

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
      expect(events.find((event) => event.type === "content.delta")?.payload).toMatchObject({
        delta: "Hello from Pi",
        streamKind: "assistant_text",
      });
    }).pipe(Effect.scoped),
  );
});
