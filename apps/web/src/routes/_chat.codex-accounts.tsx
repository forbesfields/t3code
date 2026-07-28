import { createFileRoute } from "@tanstack/react-router";
import {
  type AtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ArrowRightLeftIcon, LoaderCircleIcon, RefreshCwIcon, UserPlusIcon } from "lucide-react";
import { useEffect, useState } from "react";

import {
  parseCodexAuthAccountRows,
  resolveCodexAccountSelector,
  type CodexAccountRow,
} from "./-codex-accounts.logic";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Textarea } from "../components/ui/textarea";
import { SidebarInset } from "../components/ui/sidebar";
import { usePrimaryEnvironmentId } from "../state/environments";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";

function unwrap<A, E>(result: AtomCommandResult<A, E>): A {
  if (result._tag === "Success") return result.value;
  const error = squashAtomCommandFailure(result);
  throw error instanceof Error ? error : new Error("codex-auth request failed.");
}

function CodexAccountsRoute() {
  const environmentId = usePrimaryEnvironmentId();
  const runCommand = useAtomCommand(serverEnvironment.codexAuthRunCommand, {
    reportFailure: false,
  });
  const [accounts, setAccounts] = useState<ReadonlyArray<CodexAccountRow>>([]);
  const [output, setOutput] = useState("Loading accounts…");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [fiveHour, setFiveHour] = useState("10");
  const [weekly, setWeekly] = useState("5");
  const [advancedArgs, setAdvancedArgs] = useState("list");

  const execute = async (args: ReadonlyArray<string>) => {
    if (environmentId === null) return;
    setBusy(true);
    try {
      const result = unwrap(await runCommand({ environmentId, input: { args: [...args] } }));
      let nextOutput =
        [
          result.output.trim(),
          result.error,
          result.exitCode === 0 ? null : `Exit code: ${result.exitCode ?? "unknown"}`,
        ]
          .filter(Boolean)
          .join("\n\n") || "Command completed.";
      if (args[0] === "list") {
        const nextAccounts = parseCodexAuthAccountRows(result.output);
        if (nextAccounts.length > 0) {
          setAccounts(nextAccounts);
          nextOutput = `${nextAccounts.length} account${nextAccounts.length === 1 ? "" : "s"} loaded.`;
        }
      }
      setOutput(nextOutput);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "codex-auth request failed.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void execute(["list"]);
    // The command runner is stable for this mounted route; load the existing CLI state once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environmentId]);

  const useQuery = (command: "switch" | "remove") => {
    const target = query.trim();
    if (!target) {
      setOutput(
        `Enter an account selector before ${command === "switch" ? "switching" : "removing"}.`,
      );
      return;
    }
    if (command === "remove" && !window.confirm(`Remove ${target} from codex-auth?`)) return;
    void execute([command, resolveCodexAccountSelector(target, accounts)]);
  };

  return (
    <SidebarInset className="h-dvh min-h-0 bg-background text-foreground">
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
          <div>
            <h1 className="text-sm font-semibold">Codex accounts</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Uses your local codex-auth registry and switching rules.
            </p>
          </div>
          <Button
            className="ml-auto"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void execute(["list"])}
          >
            {busy ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-3.5" />
            )}
            Refresh
          </Button>
        </header>

        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto grid w-full max-w-3xl gap-6 p-5">
            <section className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void execute(["login"])}>
                  <UserPlusIcon className="size-3.5" />
                  Log in account
                </Button>
                <Button disabled={busy} variant="outline" onClick={() => void execute(["status"])}>
                  Show status
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Login opens the installed Codex authentication flow, then adds the authenticated
                account.
              </p>
            </section>

            <section className="grid gap-3 rounded-lg border border-border p-4">
              <label className="text-xs font-medium" htmlFor="codex-account-query">
                Account selector
              </label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="codex-account-query"
                  className="min-w-48 flex-1"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Email, alias, or row (01)"
                />
                <Button disabled={busy} onClick={() => useQuery("switch")}>
                  Switch
                </Button>
                <Button disabled={busy} variant="destructive" onClick={() => useQuery("remove")}>
                  Remove
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Row numbers from the table are supported: <code>01</code> and <code>1</code> target
                the same account.
              </p>
            </section>

            <section className="overflow-hidden rounded-lg border border-border">
              <div className="flex items-center justify-between border-b border-border bg-muted/25 px-4 py-3">
                <div>
                  <h2 className="text-xs font-medium">Account inventory</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Select a row or use its numbered slot above.
                  </p>
                </div>
                <Badge variant="outline">{accounts.length} saved</Badge>
              </div>
              {accounts.length > 0 ? (
                <Table>
                  <TableHeader className="bg-muted/25 text-[11px] text-muted-foreground">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-14">Slot</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>5h usage</TableHead>
                      <TableHead>Weekly usage</TableHead>
                      <TableHead>Last active</TableHead>
                      <TableHead className="w-20 text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accounts.map((account) => (
                      <TableRow
                        key={account.number}
                        data-state={account.active ? "selected" : undefined}
                      >
                        <TableCell>
                          <Badge variant={account.active ? "success" : "outline"}>
                            {account.number}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{account.account}</TableCell>
                        <TableCell>{account.plan}</TableCell>
                        <TableCell>{account.fiveHourUsage}</TableCell>
                        <TableCell>{account.weeklyUsage}</TableCell>
                        <TableCell>{account.lastActivity}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant={account.active ? "outline" : "ghost"}
                            disabled={busy || account.active}
                            onClick={() => {
                              setQuery(account.number);
                              void execute(["switch", account.selector]);
                            }}
                          >
                            <ArrowRightLeftIcon className="size-3.5" />
                            Switch
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                  Refresh to load the local codex-auth registry.
                </p>
              )}
            </section>

            <section className="grid gap-3 rounded-lg border border-border p-4">
              <div>
                <h2 className="text-xs font-medium">Smart switching</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  codex-auth switches when the active account reaches either usage threshold.
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-xs">
                  5 hour %
                  <Input
                    inputMode="numeric"
                    value={fiveHour}
                    onChange={(event) => setFiveHour(event.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  Weekly %
                  <Input
                    inputMode="numeric"
                    value={weekly}
                    onChange={(event) => setWeekly(event.target.value)}
                  />
                </label>
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() =>
                    void execute(["config", "auto", "--5h", fiveHour, "--weekly", weekly])
                  }
                >
                  Save thresholds
                </Button>
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() => void execute(["config", "auto", "enable"])}
                >
                  Enable
                </Button>
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() => void execute(["config", "auto", "disable"])}
                >
                  Disable
                </Button>
              </div>
            </section>

            <section className="grid gap-2 rounded-lg border border-border p-4">
              <div>
                <h2 className="text-xs font-medium">Advanced</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Run any codex-auth command, one argument per line. This covers import, export,
                  aliases, cleanup, and API options.
                </p>
              </div>
              <Textarea
                value={advancedArgs}
                onChange={(event) => setAdvancedArgs(event.target.value)}
                rows={5}
                spellCheck={false}
              />
              <div>
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() =>
                    void execute(
                      advancedArgs
                        .split("\n")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    )
                  }
                >
                  Run command
                </Button>
              </div>
            </section>

            <section className="overflow-hidden rounded-lg border border-border">
              <div className="border-b border-border bg-muted/25 px-4 py-3">
                <h2 className="text-xs font-medium">Command result</h2>
              </div>
              <Table>
                <TableBody>
                  {output
                    .split("\n")
                    .filter(Boolean)
                    .map((line, index) => (
                      <TableRow key={`${line}-${index}`}>
                        <TableCell className="whitespace-pre-wrap text-muted-foreground">
                          {line}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </section>
          </div>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/codex-accounts")({ component: CodexAccountsRoute });
