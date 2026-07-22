// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off
import { describe, expect, it } from "@effect/vitest";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { EnvironmentId, PiSettings, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { makePiAdapter, runPiCommand } from "./PiAdapter.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";

const fixture = NodeURL.fileURLToPath(new URL("./fixtures/fake-pi-rpc.mjs", import.meta.url));
const settings = Schema.decodeSync(PiSettings)({
  binaryPath: fixture,
  agentDir: "/tmp/fake-pi-agent",
});

describe("PiAdapter", () => {
  it("runs extension commands without creating a Pi session", async () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-pi-command-test-"));
    const argsPath = NodePath.join(directory, "args.json");
    try {
      const result = await runPiCommand({
        settings,
        cwd: process.cwd(),
        environment: { PI_TEST_ARGS_PATH: argsPath },
        command: "/status",
      });

      expect(result.notifications).toEqual([{ message: "Pi status is ready", type: "info" }]);
      expect(JSON.parse(NodeFS.readFileSync(argsPath, "utf8"))).toEqual([
        "--mode",
        "rpc",
        "--no-session",
      ]);
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });

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

  it.effect("passes an owner-only advisor MCP config and removes it when the session stops", () =>
    Effect.gen(function* () {
      const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-pi-adapter-test-"));
      const argsPath = NodePath.join(directory, "args.json");
      const threadId = ThreadId.make("pi-mcp-cleanup-test");
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          McpProviderSession.clearMcpProviderSession(threadId);
          NodeFS.rmSync(directory, { recursive: true, force: true });
        }),
      );
      McpProviderSession.setMcpProviderSession({
        environmentId: EnvironmentId.make("environment-local"),
        threadId,
        providerSessionId: "provider-session-test",
        providerInstanceId: ProviderInstanceId.make("pi"),
        endpoint: "http://127.0.0.1:43123/mcp",
        authorizationHeader: "Bearer test-token",
      });

      const adapter = yield* makePiAdapter(settings, {
        instanceId: ProviderInstanceId.make("pi"),
        environment: { PI_TEST_ARGS_PATH: argsPath },
      });
      yield* adapter.startSession({
        threadId,
        cwd: process.cwd(),
        runtimeMode: "full-access",
        modelSelection: { instanceId: ProviderInstanceId.make("pi"), model: "openai/gpt-5" },
      });

      const args = JSON.parse(NodeFS.readFileSync(argsPath, "utf8")) as string[];
      const configFlag = args.indexOf("--mcp-config");
      expect(configFlag).toBeGreaterThanOrEqual(0);
      const configPath = args[configFlag + 1]!;
      expect(NodeFS.statSync(configPath).mode & 0o777).toBe(0o600);
      expect(JSON.parse(NodeFS.readFileSync(configPath, "utf8"))).toMatchObject({
        mcpServers: {
          t3_code: {
            directTools: ["advisor_consult"],
            headers: { Authorization: "Bearer test-token" },
          },
        },
      });

      yield* adapter.stopSession(threadId);
      expect(NodeFS.existsSync(configPath)).toBe(false);
      expect(NodeFS.existsSync(NodePath.dirname(configPath))).toBe(false);
    }).pipe(Effect.scoped),
  );
});
