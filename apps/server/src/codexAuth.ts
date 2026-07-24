import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { collectUint8StreamText } from "./stream/collectUint8StreamText.ts";

const MAX_OUTPUT_BYTES = 1_000_000;
const COMMANDS = new Set([
  "list",
  "status",
  "login",
  "import",
  "switch",
  "remove",
  "clean",
  "config",
  "alias",
  "export",
  "--version",
  "-V",
  "--help",
  "-h",
]);

export function isCodexAuthCommand(args: ReadonlyArray<string>): boolean {
  return args.length > 0 && COMMANDS.has(args[0]!);
}

export const runCodexAuthCommand = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (!isCodexAuthCommand(args)) {
      return {
        exitCode: null,
        output: "",
        error: "Choose a supported codex-auth command.",
      };
    }

    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const spawnCommand = yield* resolveSpawnCommand("codex-auth", args);
    const child = yield* spawner.spawn(
      ChildProcess.make(spawnCommand.command, spawnCommand.args, { shell: spawnCommand.shell }),
    );
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectUint8StreamText({ stream: child.stdout, maxBytes: MAX_OUTPUT_BYTES }),
        collectUint8StreamText({ stream: child.stderr, maxBytes: MAX_OUTPUT_BYTES }),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );

    return {
      exitCode,
      output: `${stdout.text}${stderr.text}`,
      error: stdout.truncated || stderr.truncated ? "codex-auth output was truncated." : null,
    };
  }).pipe(Effect.scoped);
