import { createFileRoute } from "@tanstack/react-router";
import {
  BotIcon,
  CalendarClockIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { HermesCronAction } from "@t3tools/contracts";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { SidebarInset } from "../components/ui/sidebar";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { cn } from "../lib/utils";

type HermesTab = "chats" | "cron";
interface CronDraft {
  readonly jobId?: string;
  readonly name: string;
  readonly prompt: string;
  readonly schedule: string;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

function HermesRouteView() {
  const environmentId = usePrimaryEnvironmentId();
  const [tab, setTab] = useState<HermesTab>("chats");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [cronDraft, setCronDraft] = useState<CronDraft | null>(null);
  const [cronSaveError, setCronSaveError] = useState<string | null>(null);
  const sessions = useEnvironmentQuery(
    environmentId === null ? null : serverEnvironment.hermesSessions({ environmentId, input: {} }),
  );
  const cronJobs = useEnvironmentQuery(
    environmentId === null ? null : serverEnvironment.hermesCronJobs({ environmentId, input: {} }),
  );
  const session = useEnvironmentQuery(
    environmentId === null || selectedSessionId === null
      ? null
      : serverEnvironment.hermesSession({
          environmentId,
          input: { sessionId: selectedSessionId },
        }),
  );
  const cronAction = useAtomCommand(serverEnvironment.hermesCronAction, {
    reportFailure: false,
  });
  const saveCron = useAtomCommand(serverEnvironment.hermesSaveCron, {
    reportFailure: false,
  });

  useEffect(() => {
    if (selectedSessionId === null && sessions.data?.sessions[0]) {
      setSelectedSessionId(sessions.data.sessions[0].session_id);
    }
  }, [selectedSessionId, sessions.data]);

  const selectedSummary = useMemo(
    () => sessions.data?.sessions.find((item) => item.session_id === selectedSessionId) ?? null,
    [selectedSessionId, sessions.data],
  );

  const runCronAction = async (action: HermesCronAction, jobId: string) => {
    if (environmentId === null) return;
    if (action === "delete" && !window.confirm("Delete this Hermes cron job?")) return;
    setPendingJobId(jobId);
    try {
      await cronAction({ environmentId, input: { action, jobId } });
      cronJobs.refresh();
    } finally {
      setPendingJobId(null);
    }
  };

  const submitCron = async () => {
    if (environmentId === null || cronDraft === null) return;
    if (!cronDraft.name.trim() || !cronDraft.prompt.trim() || !cronDraft.schedule.trim()) {
      setCronSaveError("Name, schedule, and prompt are required.");
      return;
    }
    setPendingJobId(cronDraft.jobId ?? "new");
    setCronSaveError(null);
    try {
      await saveCron({ environmentId, input: cronDraft });
      setCronDraft(null);
      cronJobs.refresh();
    } catch (error) {
      setCronSaveError(error instanceof Error ? error.message : "Could not save cron job.");
    } finally {
      setPendingJobId(null);
    }
  };

  const connectionError = sessions.error ?? cronJobs.error;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
          <div className="flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-lg border border-border bg-muted/40">
              <BotIcon className="size-4 text-muted-foreground" />
            </span>
            <div>
              <h1 className="text-sm font-semibold">Hermes Control Center</h1>
              <p className="text-xs text-muted-foreground">vibeserver · Tailnet only</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              sessions.refresh();
              cronJobs.refresh();
              session.refresh();
            }}
          >
            <RefreshCwIcon /> Refresh
          </Button>
        </header>

        <div className="flex shrink-0 gap-1 border-b border-border px-5 py-2">
          <Button
            size="sm"
            variant={tab === "chats" ? "secondary" : "ghost"}
            onClick={() => setTab("chats")}
          >
            <MessageSquareIcon /> Chats
          </Button>
          <Button
            size="sm"
            variant={tab === "cron" ? "secondary" : "ghost"}
            onClick={() => setTab("cron")}
          >
            <CalendarClockIcon /> Cron jobs
            {cronJobs.data ? (
              <span className="text-xs text-muted-foreground">{cronJobs.data.jobs.length}</span>
            ) : null}
          </Button>
          {tab === "cron" ? (
            <Button
              className="ml-auto"
              size="sm"
              variant="outline"
              onClick={() => {
                setCronSaveError(null);
                setCronDraft({ name: "", prompt: "", schedule: "" });
              }}
            >
              <PlusIcon /> New cron
            </Button>
          ) : null}
        </div>

        {connectionError ? (
          <div className="m-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <p className="font-medium">Could not connect to Hermes</p>
            <p className="mt-1 text-muted-foreground">{connectionError}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Make sure Tailscale is connected and SSH access to vibeserver works.
            </p>
          </div>
        ) : tab === "chats" ? (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,300px)_1fr]">
            <ScrollArea className="border-r border-border">
              <div className="space-y-1 p-3">
                {sessions.isPending && !sessions.data ? (
                  <LoadingLabel label="Loading chats" />
                ) : null}
                {sessions.data?.sessions.map((item) => (
                  <button
                    key={item.session_id}
                    type="button"
                    className={cn(
                      "w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent",
                      selectedSessionId === item.session_id && "bg-accent",
                    )}
                    onClick={() => setSelectedSessionId(item.session_id)}
                  >
                    <div className="flex items-center gap-2">
                      {item.is_streaming ? (
                        <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                      ) : null}
                      <span className="truncate text-sm font-medium">
                        {item.title || "Untitled chat"}
                      </span>
                    </div>
                    <div className="mt-1 flex gap-2 text-[11px] text-muted-foreground">
                      <span className="truncate">{item.model}</span>
                      <span>·</span>
                      <span>{item.message_count} messages</span>
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
            <ScrollArea>
              <div className="mx-auto max-w-3xl space-y-4 p-6">
                {selectedSummary ? (
                  <div className="mb-5 border-b border-border pb-4">
                    <h2 className="font-semibold">{selectedSummary.title || "Untitled chat"}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedSummary.workspace} · {selectedSummary.model}
                    </p>
                  </div>
                ) : null}
                {session.isPending && !session.data ? (
                  <LoadingLabel label="Loading conversation" />
                ) : null}
                {session.error ? <p className="text-sm text-destructive">{session.error}</p> : null}
                {session.data?.session.messages.map((message) => (
                  <article
                    key={JSON.stringify([message.role, message.timestamp, message.content])}
                    className="rounded-xl border border-border bg-card/30 p-4"
                  >
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {message.role}
                    </p>
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                      {messageText(message.content)}
                    </pre>
                  </article>
                ))}
              </div>
            </ScrollArea>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="mx-auto grid max-w-5xl gap-3 p-5 md:grid-cols-2">
              {cronDraft ? (
                <section className="rounded-xl border border-primary/30 bg-card p-4 md:col-span-2">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">
                      {cronDraft.jobId ? "Edit cron job" : "New cron job"}
                    </h2>
                    <Button size="xs" variant="ghost" onClick={() => setCronDraft(null)}>
                      Cancel
                    </Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1.5 text-xs font-medium">
                      Name
                      <Input
                        value={cronDraft.name}
                        onChange={(event) =>
                          setCronDraft({ ...cronDraft, name: event.target.value })
                        }
                      />
                    </label>
                    <label className="space-y-1.5 text-xs font-medium">
                      Schedule
                      <Input
                        placeholder="30 1 * * * or every day at 1:30am"
                        value={cronDraft.schedule}
                        onChange={(event) =>
                          setCronDraft({ ...cronDraft, schedule: event.target.value })
                        }
                      />
                    </label>
                    <label className="space-y-1.5 text-xs font-medium md:col-span-2">
                      Prompt
                      <Textarea
                        className="min-h-28"
                        value={cronDraft.prompt}
                        onChange={(event) =>
                          setCronDraft({ ...cronDraft, prompt: event.target.value })
                        }
                      />
                    </label>
                  </div>
                  {cronSaveError ? (
                    <p className="mt-3 text-xs text-destructive">{cronSaveError}</p>
                  ) : null}
                  <div className="mt-4 flex justify-end">
                    <Button
                      size="sm"
                      disabled={pendingJobId === (cronDraft.jobId ?? "new")}
                      onClick={() => void submitCron()}
                    >
                      {pendingJobId === (cronDraft.jobId ?? "new") ? (
                        <LoaderCircleIcon className="animate-spin" />
                      ) : null}
                      {cronDraft.jobId ? "Save changes" : "Create cron"}
                    </Button>
                  </div>
                </section>
              ) : null}
              {cronJobs.isPending && !cronJobs.data ? (
                <LoadingLabel label="Loading cron jobs" />
              ) : null}
              {cronJobs.data?.jobs.map((job) => (
                <article key={job.id} className="rounded-xl border border-border bg-card/30 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold">{job.name}</h2>
                      <p className="mt-1 text-xs text-muted-foreground">{job.schedule_display}</p>
                    </div>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        job.enabled
                          ? "bg-emerald-500/10 text-emerald-600"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {job.enabled ? "Active" : "Paused"}
                    </span>
                  </div>
                  <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                    {job.prompt}
                  </p>
                  <div className="mt-3 text-[11px] text-muted-foreground">
                    {job.model} · {job.last_status || "No runs yet"}
                  </div>
                  <div className="mt-4 flex gap-1.5">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        setCronSaveError(null);
                        setCronDraft({
                          jobId: job.id,
                          name: job.name,
                          prompt: job.prompt,
                          schedule: job.schedule_display,
                        });
                      }}
                    >
                      <PencilIcon /> Edit
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={pendingJobId === job.id}
                      onClick={() => void runCronAction("run", job.id)}
                    >
                      <PlayIcon /> Run
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={pendingJobId === job.id}
                      onClick={() => void runCronAction(job.enabled ? "pause" : "resume", job.id)}
                    >
                      {job.enabled ? <PauseIcon /> : <PlayIcon />}{" "}
                      {job.enabled ? "Pause" : "Resume"}
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      disabled={pendingJobId === job.id}
                      aria-label={`Delete ${job.name}`}
                      onClick={() => void runCronAction("delete", job.id)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </SidebarInset>
  );
}

function LoadingLabel({ label }: { readonly label: string }) {
  return (
    <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
      <LoaderCircleIcon className="size-4 animate-spin" /> {label}
    </div>
  );
}

export const Route = createFileRoute("/_chat/hermes")({
  component: HermesRouteView,
});
