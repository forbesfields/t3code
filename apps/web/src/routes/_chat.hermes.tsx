import { createFileRoute } from "@tanstack/react-router";
import {
  type AtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  BotIcon,
  CalendarClockIcon,
  CornerDownRightIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SendIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { HermesApprovalChoice, HermesCronAction } from "@t3tools/contracts";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
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

interface HermesModelOption {
  readonly value: string;
  readonly id: string;
  readonly label: string;
  readonly providerId: string;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

function unwrapCommandResult<A, E>(result: AtomCommandResult<A, E>): A {
  if (result._tag === "Success") return result.value;
  const error = squashAtomCommandFailure(result);
  throw error instanceof Error ? error : new Error("Hermes request failed.");
}

function HermesRouteView() {
  const environmentId = usePrimaryEnvironmentId();
  const [tab, setTab] = useState<HermesTab>("chats");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [cronDraft, setCronDraft] = useState<CronDraft | null>(null);
  const [cronSaveError, setCronSaveError] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatPending, setChatPending] = useState(false);
  const [approvalPending, setApprovalPending] = useState<HermesApprovalChoice | null>(null);
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null);
  const [selectedModelValue, setSelectedModelValue] = useState("");
  const [modelSessionId, setModelSessionId] = useState<string | null>(null);
  const sessions = useEnvironmentQuery(
    environmentId === null ? null : serverEnvironment.hermesSessions({ environmentId, input: {} }),
  );
  const cronJobs = useEnvironmentQuery(
    environmentId === null ? null : serverEnvironment.hermesCronJobs({ environmentId, input: {} }),
  );
  const models = useEnvironmentQuery(
    environmentId === null ? null : serverEnvironment.hermesModels({ environmentId, input: {} }),
  );
  const session = useEnvironmentQuery(
    environmentId === null || selectedSessionId === null
      ? null
      : serverEnvironment.hermesSession({
          environmentId,
          input: { sessionId: selectedSessionId },
        }),
  );
  const approval = useEnvironmentQuery(
    environmentId === null || selectedSessionId === null
      ? null
      : serverEnvironment.hermesApproval({
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
  const createSession = useAtomCommand(serverEnvironment.hermesCreateSession, {
    reportFailure: false,
  });
  const sendMessage = useAtomCommand(serverEnvironment.hermesSendMessage, {
    reportFailure: false,
  });
  const steerChat = useAtomCommand(serverEnvironment.hermesSteerChat, {
    reportFailure: false,
  });
  const cancelChat = useAtomCommand(serverEnvironment.hermesCancelChat, {
    reportFailure: false,
  });
  const respondApproval = useAtomCommand(serverEnvironment.hermesRespondApproval, {
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

  const modelOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: HermesModelOption[] = [];
    for (const group of models.data?.groups ?? []) {
      const providerId = group.provider_id ?? group.provider;
      for (const model of [...group.models, ...(group.extra_models ?? [])]) {
        const value = JSON.stringify([providerId, model.id]);
        if (seen.has(value)) continue;
        seen.add(value);
        options.push({
          value,
          id: model.id,
          label: model.label,
          providerId,
        });
      }
    }
    return options;
  }, [models.data]);

  const selectedModel = useMemo(
    () => modelOptions.find((model) => model.value === selectedModelValue) ?? null,
    [modelOptions, selectedModelValue],
  );

  useEffect(() => {
    const current = session.data?.session;
    if (
      !current ||
      current.session_id !== selectedSessionId ||
      modelSessionId === current.session_id
    )
      return;
    const exact = modelOptions.find(
      (model) =>
        model.id === current.model &&
        (!current.model_provider || model.providerId === current.model_provider),
    );
    const fallback = exact ?? modelOptions.find((model) => model.id === current.model);
    setSelectedModelValue(
      fallback?.value ?? JSON.stringify([current.model_provider ?? "", current.model]),
    );
    setModelSessionId(current.session_id);
  }, [modelOptions, modelSessionId, selectedSessionId, session.data]);

  useEffect(() => {
    const modelData = models.data;
    if (selectedModelValue || !modelData) return;
    const fallback =
      modelOptions.find(
        (model) =>
          model.id === modelData.default_model && model.providerId === modelData.active_provider,
      ) ?? modelOptions.find((model) => model.id === modelData.default_model);
    if (fallback) setSelectedModelValue(fallback.value);
  }, [modelOptions, models.data, selectedModelValue]);

  useEffect(() => {
    if (tab !== "chats" || selectedSessionId === null) return;
    // ponytail: poll the existing HTTP bridge; replace with streamed RPC only if token latency matters.
    const timer = window.setInterval(() => {
      session.refresh();
      sessions.refresh();
      approval.refresh();
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [approval, selectedSessionId, session, sessions, tab]);

  const refreshChat = () => {
    session.refresh();
    sessions.refresh();
    approval.refresh();
  };

  const createNewChat = async () => {
    if (environmentId === null) return;
    setChatPending(true);
    setChatError(null);
    try {
      const result = unwrapCommandResult(
        await createSession({
          environmentId,
          input: {
            ...(selectedModel
              ? { model: selectedModel.id, modelProvider: selectedModel.providerId }
              : {}),
            ...(session.data?.session.workspace
              ? { workspace: session.data.session.workspace }
              : {}),
          },
        }),
      );
      setSelectedSessionId(result.session.session_id);
      setModelSessionId(result.session.session_id);
      setSelectedModelValue(
        JSON.stringify([result.session.model_provider ?? "", result.session.model]),
      );
      sessions.refresh();
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Could not create Hermes chat.");
    } finally {
      setChatPending(false);
    }
  };

  const submitChat = async () => {
    const current = session.data?.session;
    const text = chatDraft.trim();
    if (environmentId === null || !current || !text) return;
    setChatPending(true);
    setChatError(null);
    try {
      if (current.is_streaming) {
        const result = unwrapCommandResult(
          await steerChat({
            environmentId,
            input: { sessionId: current.session_id, text },
          }),
        );
        if (!result.accepted)
          throw new Error(`Hermes could not steer this turn (${result.fallback}).`);
      } else {
        const modelProvider = selectedModel?.providerId ?? current.model_provider ?? undefined;
        const result = unwrapCommandResult(
          await sendMessage({
            environmentId,
            input: {
              sessionId: current.session_id,
              message: text,
              model: selectedModel?.id ?? current.model,
              ...(modelProvider ? { modelProvider } : {}),
              workspace: current.workspace,
            },
          }),
        );
        setActiveStreamId(result.stream_id);
      }
      setChatDraft("");
      refreshChat();
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Could not send message to Hermes.");
    } finally {
      setChatPending(false);
    }
  };

  const stopChat = async () => {
    if (environmentId === null) return;
    const streamId = session.data?.session.active_stream_id ?? activeStreamId;
    if (!streamId) return;
    setChatPending(true);
    setChatError(null);
    try {
      unwrapCommandResult(await cancelChat({ environmentId, input: { streamId } }));
      setActiveStreamId(null);
      refreshChat();
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Could not stop Hermes.");
    } finally {
      setChatPending(false);
    }
  };

  const answerApproval = async (choice: HermesApprovalChoice) => {
    if (environmentId === null || selectedSessionId === null) return;
    setApprovalPending(choice);
    setChatError(null);
    try {
      const approvalId = approval.data?.pending?.approval_id;
      unwrapCommandResult(
        await respondApproval({
          environmentId,
          input: {
            sessionId: selectedSessionId,
            ...(approvalId ? { approvalId } : {}),
            choice,
          },
        }),
      );
      refreshChat();
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Could not answer Hermes approval.");
    } finally {
      setApprovalPending(null);
    }
  };

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
              models.refresh();
              session.refresh();
              approval.refresh();
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
          ) : (
            <Button
              className="ml-auto"
              size="sm"
              variant="outline"
              disabled={chatPending}
              onClick={() => void createNewChat()}
            >
              <PlusIcon /> New chat
            </Button>
          )}
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
            <div className="flex min-h-0 flex-col">
              <ScrollArea className="min-h-0 flex-1">
                <div className="mx-auto max-w-3xl space-y-4 p-6">
                  {selectedSummary ? (
                    <div className="mb-5 border-b border-border pb-4">
                      <div className="flex items-center gap-2">
                        <h2 className="font-semibold">
                          {selectedSummary.title || "Untitled chat"}
                        </h2>
                        {session.data?.session.is_streaming ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                            Working
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {selectedSummary.workspace} · {selectedSummary.model}
                      </p>
                    </div>
                  ) : null}
                  {session.isPending && !session.data ? (
                    <LoadingLabel label="Loading conversation" />
                  ) : null}
                  {session.error ? (
                    <p className="text-sm text-destructive">{session.error}</p>
                  ) : null}
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
                  {session.data?.session.is_streaming ? (
                    <LoadingLabel label="Hermes is working" />
                  ) : null}
                </div>
              </ScrollArea>

              {session.data ? (
                <div className="shrink-0 border-t border-border bg-background p-4">
                  <div className="mx-auto max-w-3xl space-y-3">
                    {approval.data?.pending ? (
                      <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                        <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                          Hermes needs approval
                          {approval.data.pending_count > 1
                            ? ` · ${approval.data.pending_count} pending`
                            : ""}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                          {approval.data.pending.description ??
                            approval.data.pending.command ??
                            "Allow this action?"}
                        </p>
                        {approval.data.pending.command ? (
                          <code className="mt-2 block rounded-md bg-background/70 p-2 text-xs">
                            {approval.data.pending.command}
                          </code>
                        ) : null}
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={approvalPending !== null}
                            onClick={() => void answerApproval("once")}
                          >
                            Allow once
                          </Button>
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={approvalPending !== null}
                            onClick={() => void answerApproval("session")}
                          >
                            Allow session
                          </Button>
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={approvalPending !== null}
                            onClick={() => void answerApproval("always")}
                          >
                            Always allow
                          </Button>
                          <Button
                            size="xs"
                            variant="destructive"
                            disabled={approvalPending !== null}
                            onClick={() => void answerApproval("deny")}
                          >
                            Deny
                          </Button>
                        </div>
                      </section>
                    ) : null}

                    <form
                      className="rounded-xl border border-input bg-card/30 p-2 shadow-xs"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submitChat();
                      }}
                    >
                      <Textarea
                        className="min-h-20 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
                        placeholder={
                          session.data.session.is_streaming
                            ? "Steer the active Hermes turn…"
                            : "Message Hermes…"
                        }
                        value={chatDraft}
                        onChange={(event) => setChatDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            void submitChat();
                          }
                        }}
                      />
                      <div className="flex items-center gap-2 border-t border-border/60 pt-2">
                        {modelOptions.length > 0 ? (
                          <Select
                            modal={false}
                            value={selectedModelValue || null}
                            onValueChange={(value) => value && setSelectedModelValue(value)}
                            items={modelOptions.map((model) => ({
                              value: model.value,
                              label: model.label,
                            }))}
                          >
                            <SelectTrigger
                              size="xs"
                              variant="ghost"
                              className="max-w-56"
                              aria-label="Hermes model"
                            >
                              <SelectValue placeholder="Choose model" />
                            </SelectTrigger>
                            <SelectPopup alignItemWithTrigger={false} className="max-h-80">
                              {models.data?.groups.map((group) => {
                                const providerId = group.provider_id ?? group.provider;
                                const options = modelOptions.filter(
                                  (model) => model.providerId === providerId,
                                );
                                if (options.length === 0) return null;
                                return (
                                  <SelectGroup key={providerId}>
                                    <SelectGroupLabel>{group.provider}</SelectGroupLabel>
                                    {options.map((model) => (
                                      <SelectItem key={model.value} value={model.value}>
                                        {model.label}
                                      </SelectItem>
                                    ))}
                                  </SelectGroup>
                                );
                              })}
                            </SelectPopup>
                          </Select>
                        ) : (
                          <span className="px-2 text-xs text-muted-foreground">
                            {models.error ?? "Loading models…"}
                          </span>
                        )}
                        <span className="flex-1" />
                        {session.data.session.is_streaming ? (
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            disabled={chatPending}
                            onClick={() => void stopChat()}
                          >
                            <SquareIcon /> Stop
                          </Button>
                        ) : null}
                        <Button type="submit" size="xs" disabled={chatPending || !chatDraft.trim()}>
                          {chatPending ? (
                            <LoaderCircleIcon className="animate-spin" />
                          ) : session.data.session.is_streaming ? (
                            <CornerDownRightIcon />
                          ) : (
                            <SendIcon />
                          )}
                          {session.data.session.is_streaming ? "Steer" : "Send"}
                        </Button>
                      </div>
                    </form>
                    {chatError ? <p className="text-xs text-destructive">{chatError}</p> : null}
                  </div>
                </div>
              ) : null}
            </div>
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
