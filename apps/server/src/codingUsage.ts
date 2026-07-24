import { resolveSpawnCommand } from "@t3tools/shared/shell";
import { CodingUsageReport } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { collectUint8StreamText } from "./stream/collectUint8StreamText.ts";

const REFRESH_AFTER_MS = 30 * 60 * 1000;
const MAX_OUTPUT_BYTES = 5_000_000;
let cached: CodingUsageReport | null = null;
let refreshedAtMs = 0;
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const CliReport = Schema.Struct({
  daily: Schema.Array(
    Schema.Struct({
      period: Schema.String,
      inputTokens: NonNegativeInt,
      outputTokens: NonNegativeInt,
      cacheReadTokens: NonNegativeInt,
      cacheCreationTokens: NonNegativeInt,
      totalTokens: NonNegativeInt,
      totalCost: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
      modelBreakdowns: Schema.Array(
        Schema.Struct({
          modelName: Schema.String,
          inputTokens: NonNegativeInt,
          outputTokens: NonNegativeInt,
          cacheReadTokens: NonNegativeInt,
          cacheCreationTokens: NonNegativeInt,
          totalTokens: NonNegativeInt,
          cost: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
        }),
      ),
    }),
  ),
  totals: Schema.Struct({
    inputTokens: NonNegativeInt,
    outputTokens: NonNegativeInt,
    cacheReadTokens: NonNegativeInt,
    cacheCreationTokens: NonNegativeInt,
    totalTokens: NonNegativeInt,
    totalCost: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
  metadata: Schema.Struct({ machines: Schema.Array(Schema.String) }),
});

export const getCodingUsageReport = Effect.fn("codingUsage.getCodingUsageReport")(function* () {
  const now = yield* DateTime.now;
  const nowMs = DateTime.toEpochMillis(now);
  if (cached !== null && nowMs - refreshedAtMs < REFRESH_AFTER_MS) return cached;

  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const environment = { CCUSAGE_HA_SYNC_DISABLE: "1" };
  const spawnCommand = yield* resolveSpawnCommand("ccusage-omp", ["daily", "--json"], {
    env: environment,
    extendEnv: true,
  });
  const child = yield* spawner.spawn(
    ChildProcess.make(spawnCommand.command, spawnCommand.args, {
      env: environment,
      extendEnv: true,
      shell: spawnCommand.shell,
    }),
  );
  const [stdout, stderr, exitCode] = yield* Effect.all([
    collectUint8StreamText({ stream: child.stdout, maxBytes: MAX_OUTPUT_BYTES }),
    collectUint8StreamText({ stream: child.stderr, maxBytes: MAX_OUTPUT_BYTES }),
    child.exitCode.pipe(Effect.map(Number)),
  ]);
  const refreshedAt = DateTime.formatIso(now);
  if (exitCode !== 0 || stdout.truncated || stderr.truncated) {
    return {
      daily: [],
      totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0, totalCost: 0 },
      machines: [],
      refreshedAt,
      refreshAfterMs: REFRESH_AFTER_MS,
      error: stderr.text.trim() || "ccusage-omp did not return a report.",
    };
  }
  const decoded = yield* Schema.decodeEffect(Schema.fromJsonString(CliReport))(stdout.text).pipe(
    Effect.orElseSucceed(() => null),
  );
  if (decoded === null) {
    return {
      daily: [],
      totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0, totalCost: 0 },
      machines: [],
      refreshedAt,
      refreshAfterMs: REFRESH_AFTER_MS,
      error: "ccusage-omp returned an invalid usage report.",
    };
  }
  const report = {
    daily: decoded.daily,
    totals: decoded.totals,
    machines: decoded.metadata.machines,
    refreshedAt,
    refreshAfterMs: REFRESH_AFTER_MS,
    error: null,
  } satisfies CodingUsageReport;
  cached = report;
  refreshedAtMs = nowMs;
  return report;
});
