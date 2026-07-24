import { createFileRoute } from "@tanstack/react-router";
import { type AtomCommandResult, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { CodingUsageDay, CodingUsageModel, CodingUsageReport } from "@t3tools/contracts";
import { useEffect, useMemo, useState } from "react";

import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { SidebarInset } from "../components/ui/sidebar";
import { usePrimaryEnvironmentId } from "../state/environments";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";

type Period = "today" | "week" | "month" | "all";
type Metric = "tokens" | "cost";
type HeatmapCell = { period: string; row: CodingUsageDay | null } | null;

const HEATMAP_LEVELS = ["bg-muted", "bg-primary/25", "bg-primary/45", "bg-primary/70", "bg-primary"] as const;

function unwrap<A, E>(result: AtomCommandResult<A, E>): A {
  if (result._tag === "Success") return result.value;
  const error = squashAtomCommandFailure(result);
  throw error instanceof Error ? error : new Error("Could not load coding usage.");
}

const formatTokens = (value: number) =>
  value >= 1_000_000_000 ? `${(value / 1_000_000_000).toFixed(2)}B` : `${(value / 1_000_000).toFixed(1)}M`;
const formatCost = (value: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(value);

function rowsForPeriod(daily: ReadonlyArray<CodingUsageDay>, period: Period) {
  const latest = daily.at(-1);
  if (!latest || period === "today") return latest ? [latest] : [];
  if (period === "week") return daily.slice(-7);
  if (period === "month") return daily.filter((row) => row.period.startsWith(latest.period.slice(0, 7)));
  return daily;
}

function summarize(rows: ReadonlyArray<CodingUsageDay>) {
  const models = new Map<string, CodingUsageModel>();
  const total = rows.reduce(
    (value, row) => {
      for (const model of row.modelBreakdowns) {
        const previous = models.get(model.modelName);
        models.set(model.modelName, {
          ...model,
          inputTokens: (previous?.inputTokens ?? 0) + model.inputTokens,
          outputTokens: (previous?.outputTokens ?? 0) + model.outputTokens,
          cacheReadTokens: (previous?.cacheReadTokens ?? 0) + model.cacheReadTokens,
          cacheCreationTokens: (previous?.cacheCreationTokens ?? 0) + model.cacheCreationTokens,
          totalTokens: (previous?.totalTokens ?? 0) + model.totalTokens,
          cost: (previous?.cost ?? 0) + model.cost,
        });
      }
      return {
        input: value.input + row.inputTokens,
        cache: value.cache + row.cacheReadTokens,
        tokens: value.tokens + row.totalTokens,
        cost: value.cost + row.totalCost,
      };
    },
    { input: 0, cache: 0, tokens: 0, cost: 0 },
  );
  return { ...total, models: [...models.values()].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 5) };
}

function dateForPeriod(period: string) {
  const [year, month, day] = period.split("-").map(Number);
  return new Date(year!, month! - 1, day!);
}

function allTimeHeatmap(daily: ReadonlyArray<CodingUsageDay>) {
  const sorted = [...daily].sort((a, b) => a.period.localeCompare(b.period));
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) return [] as HeatmapCell[];

  const byPeriod = new Map(sorted.map((row) => [row.period, row]));
  const cells: HeatmapCell[] = Array.from({ length: dateForPeriod(first.period).getDay() }, () => null);
  const cursor = dateForPeriod(first.period);
  const end = dateForPeriod(last.period);
  while (cursor <= end) {
    const period = [cursor.getFullYear(), String(cursor.getMonth() + 1).padStart(2, "0"), String(cursor.getDate()).padStart(2, "0")].join("-");
    cells.push({ period, row: byPeriod.get(period) ?? null });
    cursor.setDate(cursor.getDate() + 1);
  }
  return cells;
}

function heatmapLevel(tokens: number, maximum: number) {
  if (tokens === 0) return HEATMAP_LEVELS[0];
  const ratio = tokens / maximum;
  if (ratio < 0.12) return HEATMAP_LEVELS[1];
  if (ratio < 0.35) return HEATMAP_LEVELS[2];
  if (ratio < 0.7) return HEATMAP_LEVELS[3];
  return HEATMAP_LEVELS[4];
}

function UsageRoute() {
  const environmentId = usePrimaryEnvironmentId();
  const getReport = useAtomCommand(serverEnvironment.codingUsageGetReport, { reportFailure: false });
  const [report, setReport] = useState<CodingUsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("today");
  const [metric, setMetric] = useState<Metric>("tokens");

  useEffect(() => {
    if (environmentId !== null) {
      void getReport({ environmentId, input: {} })
        .then(unwrap)
        .then(setReport)
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load coding usage."));
    }
  }, [environmentId, getReport]);

  const daily = report?.daily ?? [];
  const rows = useMemo(() => rowsForPeriod(daily, period), [daily, period]);
  const summary = useMemo(() => summarize(rows), [rows]);
  const heatmapCells = useMemo(() => allTimeHeatmap(daily), [daily]);
  const heatmapMaximum = Math.max(1, ...daily.map((row) => row.totalTokens));
  const cacheShare = summary.input + summary.cache === 0 ? 0 : summary.cache / (summary.input + summary.cache);
  const detail = period === "today" ? "latest daily total" : "daily totals";

  return (
    <SidebarInset className="h-dvh min-h-0 bg-background text-foreground">
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
          <div>
            <h1 className="text-sm font-semibold">Usage</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">ccusage-omp • {report?.machines.join(" + ") || "loading machines"} • max once every 30 min</p>
          </div>
          <span className="ml-auto text-xs text-muted-foreground">{report ? `updated ${new Date(report.refreshedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Loading…"}</span>
        </header>
        <ScrollArea className="min-h-0 flex-1">
          <main className="mx-auto grid w-full max-w-5xl gap-7 p-5">
            <div className="flex flex-wrap gap-2">
              {(["today", "week", "month", "all"] as const).map((value) => (
                <Button key={value} size="sm" variant={period === value ? "default" : "outline"} onClick={() => setPeriod(value)}>
                  {value === "all" ? "All time" : value[0]!.toUpperCase() + value.slice(1)}
                </Button>
              ))}
            </div>

            {error || report?.error ? (
              <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{error || report?.error}</p>
            ) : (
              <>
                <section className="flex flex-wrap items-end gap-8 border-b border-border pb-6">
                  <div>
                    <p className="text-xs text-muted-foreground">{rows.at(-1)?.period ?? "No usage yet"} · {detail}</p>
                    <h2 className="mt-1 text-4xl font-semibold tracking-tight">{metric === "tokens" ? `${formatTokens(summary.tokens)} tokens` : formatCost(summary.cost)}</h2>
                  </div>
                  <div className="border-l-2 border-primary pl-4 text-xs text-muted-foreground" title="cache reads ÷ (input + cache reads)">
                    Cache read share
                    <b className="mt-1 block text-xl text-foreground">{(cacheShare * 100).toFixed(1)}%</b>
                  </div>
                </section>

                <div className="flex gap-2">
                  <Button size="sm" variant={metric === "tokens" ? "default" : "outline"} onClick={() => setMetric("tokens")}>Tokens</Button>
                  <Button size="sm" variant={metric === "cost" ? "default" : "outline"} onClick={() => setMetric("cost")}>Estimated cost</Button>
                </div>

                <section>
                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <h2 className="text-sm font-medium">All-time token activity</h2>
                        <p className="mt-0.5 text-xs text-muted-foreground">One square per day</p>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span>Less</span>
                        {HEATMAP_LEVELS.map((level) => <span className={`size-3 rounded-[3px] ${level}`} key={level} />)}
                        <span>More</span>
                      </div>
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-border bg-card p-4">
                      <div className="grid min-w-[720px] auto-cols-fr grid-flow-col grid-rows-7 gap-1">
                        {heatmapCells.map((cell, index) => cell ? (
                          <div className={`aspect-square rounded-[3px] ${heatmapLevel(cell.row?.totalTokens ?? 0, heatmapMaximum)}`} key={cell.period} title={`${cell.period}\n${formatTokens(cell.row?.totalTokens ?? 0)} tokens\n${formatCost(cell.row?.totalCost ?? 0)} estimated cost`} />
                        ) : <div key={`pad-${index}`} />)}
                      </div>
                      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                        <span>{daily[0]?.period ?? ""}</span>
                        <span>{daily.at(-1)?.period ?? ""}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="text-sm font-medium">Top five models</h2>
                      <span className="text-xs text-muted-foreground">by tokens</span>
                    </div>
                    <div className="border-t border-border">
                      {summary.models.map((model, index) => (
                        <div className="grid grid-cols-[2rem_1fr_auto] gap-3 border-b border-border py-3" key={model.modelName}>
                          <span className="text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                          <span className="min-w-0 truncate">{model.modelName}<small className="mt-0.5 block text-xs text-muted-foreground">{formatCost(model.cost)} estimated</small></span>
                          <b>{formatTokens(model.totalTokens)}</b>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                <p className="text-xs text-muted-foreground">Estimated cost uses ccusage’s reported cost plus configured fallback prices when a source reports $0.00.</p>
              </>
            )}
          </main>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/usage")({ component: UsageRoute });
