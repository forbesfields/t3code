import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { ErrorBanner } from "../../components/ErrorBanner";
import { ConnectionSheetButton } from "../connection/ConnectionSheetButton";
import { useEnvironments } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  parseCodexAuthAccountRows,
  resolveCodexAccountSelector,
  type CodexAccountRow,
} from "../codex-accounts/codex-account-output";
import { SettingsSection } from "./components/SettingsSection";

function unwrap<A, E>(result: AtomCommandResult<A, E>): A {
  if (result._tag === "Success") return result.value;
  const error = squashAtomCommandFailure(result);
  throw error instanceof Error ? error : new Error("codex-auth request failed.");
}

export function SettingsCodexAccountsRouteScreen() {
  const insets = useSafeAreaInsets();
  const { environments } = useEnvironments();
  const environmentId = useMemo(
    () =>
      environments.find((environment) => environment.connection.phase === "connected")
        ?.environmentId ??
      environments[0]?.environmentId ??
      null,
    [environments],
  );
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

  const execute = useCallback(
    async (args: ReadonlyArray<string>) => {
      if (environmentId === null) {
        setOutput("Connect an environment before managing Codex accounts.");
        return;
      }

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
          setAccounts(nextAccounts);
          nextOutput = `${nextAccounts.length} account${nextAccounts.length === 1 ? "" : "s"} loaded.`;
        }
        setOutput(nextOutput);
      } catch (error) {
        setOutput(error instanceof Error ? error.message : "codex-auth request failed.");
      } finally {
        setBusy(false);
      }
    },
    [environmentId, runCommand],
  );

  useEffect(() => {
    if (environmentId !== null) void execute(["list"]);
  }, [environmentId, execute]);

  const useQuery = useCallback(
    (command: "switch" | "remove") => {
      const target = query.trim();
      if (!target) {
        setOutput(
          `Enter an account selector before ${command === "switch" ? "switching" : "removing"}.`,
        );
        return;
      }
      const selector = resolveCodexAccountSelector(target, accounts);
      if (command === "remove") {
        Alert.alert("Remove account?", `Remove ${target} from codex-auth on this environment?`, [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () => void execute([command, selector]),
          },
        ]);
        return;
      }
      void execute([command, selector]);
    },
    [accounts, execute, query],
  );

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <View className="gap-2 px-2">
          <Text className="text-sm leading-normal text-foreground-muted">
            Manage the codex-auth registry on the connected T3 Code environment.
          </Text>
          {environmentId === null ? (
            <ErrorBanner message="Connect an environment to manage Codex accounts." />
          ) : null}
        </View>

        <SettingsSection title="Accounts">
          <View className="gap-3 p-4">
            <View className="flex-row gap-2">
              <View className="flex-1">
                <ConnectionSheetButton
                  compact
                  icon="person.badge.plus"
                  label="Log in"
                  disabled={busy || environmentId === null}
                  tone="primary"
                  onPress={() => void execute(["login"])}
                />
              </View>
              <View className="flex-1">
                <ConnectionSheetButton
                  compact
                  icon="arrow.clockwise"
                  label="Refresh"
                  disabled={busy || environmentId === null}
                  onPress={() => void execute(["list"])}
                />
              </View>
              <View className="flex-1">
                <ConnectionSheetButton
                  compact
                  icon="info.circle"
                  label="Status"
                  disabled={busy || environmentId === null}
                  onPress={() => void execute(["status"])}
                />
              </View>
            </View>
            <Text className="text-sm leading-normal text-foreground-muted">
              Login runs the installed Codex authentication flow on that environment.
            </Text>
          </View>
        </SettingsSection>

        <SettingsSection title={`Account inventory · ${accounts.length}`}>
          {accounts.length > 0 ? (
            accounts.map((account, index) => (
              <AccountRow
                key={account.number}
                account={account}
                disabled={busy || environmentId === null}
                first={index === 0}
                onSwitch={() => {
                  setQuery(account.number);
                  void execute(["switch", account.selector]);
                }}
              />
            ))
          ) : (
            <View className="items-center gap-2 px-6 py-8">
              {busy ? <ActivityIndicator /> : null}
              <Text className="text-center text-sm text-foreground-muted">
                {busy ? "Loading accounts…" : "Refresh to load the codex-auth registry."}
              </Text>
            </View>
          )}
        </SettingsSection>

        <SettingsSection title="Switch or remove">
          <View className="gap-3 p-4">
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="default"
              placeholder="Email, alias, or row (01)"
              value={query}
              onChangeText={setQuery}
              className="rounded-[14px] border border-input-border bg-input px-4 py-3.5 text-base text-foreground"
            />
            <Text className="text-sm leading-normal text-foreground-muted">
              Row 01 and row 1 both resolve to the same saved account.
            </Text>
            <View className="flex-row gap-2">
              <View className="flex-1">
                <ConnectionSheetButton
                  compact
                  icon="arrow.left.arrow.right"
                  label="Switch"
                  disabled={busy || environmentId === null}
                  tone="primary"
                  onPress={() => useQuery("switch")}
                />
              </View>
              <View className="flex-1">
                <ConnectionSheetButton
                  compact
                  icon="trash"
                  label="Remove"
                  disabled={busy || environmentId === null}
                  tone="danger"
                  onPress={() => useQuery("remove")}
                />
              </View>
            </View>
          </View>
        </SettingsSection>

        <SettingsSection title="Smart switching">
          <View className="gap-3 p-4">
            <Text className="text-sm leading-normal text-foreground-muted">
              Switch automatically when the active account reaches either threshold.
            </Text>
            <View className="flex-row gap-3">
              <ThresholdInput label="5 hour %" value={fiveHour} onChangeText={setFiveHour} />
              <ThresholdInput label="Weekly %" value={weekly} onChangeText={setWeekly} />
            </View>
            <ConnectionSheetButton
              compact
              icon="checkmark"
              label="Save thresholds"
              disabled={busy || environmentId === null}
              onPress={() => void execute(["config", "auto", "--5h", fiveHour, "--weekly", weekly])}
            />
            <View className="flex-row gap-2">
              <View className="flex-1">
                <ConnectionSheetButton
                  compact
                  icon="bolt.fill"
                  label="Enable"
                  disabled={busy || environmentId === null}
                  tone="primary"
                  onPress={() => void execute(["config", "auto", "enable"])}
                />
              </View>
              <View className="flex-1">
                <ConnectionSheetButton
                  compact
                  icon="pause.fill"
                  label="Disable"
                  disabled={busy || environmentId === null}
                  onPress={() => void execute(["config", "auto", "disable"])}
                />
              </View>
            </View>
          </View>
        </SettingsSection>

        <SettingsSection title="Advanced">
          <View className="gap-3 p-4">
            <Text className="text-sm leading-normal text-foreground-muted">
              One argument per line. Supports import, export, aliases, cleanup, and API options.
            </Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
              value={advancedArgs}
              onChangeText={setAdvancedArgs}
              className="min-h-32 rounded-[14px] border border-input-border bg-input px-4 py-3.5 font-mono text-sm text-foreground"
            />
            <ConnectionSheetButton
              compact
              icon="terminal"
              label="Run command"
              disabled={busy || environmentId === null}
              onPress={() =>
                void execute(
                  advancedArgs
                    .split("\n")
                    .map((value) => value.trim())
                    .filter(Boolean),
                )
              }
            />
          </View>
        </SettingsSection>

        <SettingsSection title="Command result">
          <View className="p-4">
            {output
              .split("\n")
              .filter(Boolean)
              .map((line, index) => (
                <Text
                  key={`${line}-${index}`}
                  selectable
                  className={
                    index === 0
                      ? "text-sm text-foreground-muted"
                      : "border-t border-border pt-2 text-sm text-foreground-muted"
                  }
                >
                  {line}
                </Text>
              ))}
          </View>
        </SettingsSection>
      </ScrollView>
    </View>
  );
}

function AccountRow(props: {
  readonly account: CodexAccountRow;
  readonly disabled: boolean;
  readonly first: boolean;
  readonly onSwitch: () => void;
}) {
  return (
    <View className={props.first ? "gap-3 p-4" : "gap-3 border-t border-border p-4"}>
      <View className="flex-row items-center gap-2">
        <View
          className={
            props.account.active
              ? "rounded-full bg-primary px-2 py-1"
              : "rounded-full bg-subtle px-2 py-1"
          }
        >
          <Text
            className={
              props.account.active
                ? "text-2xs font-t3-bold text-primary-foreground"
                : "text-2xs font-t3-bold text-foreground-muted"
            }
          >
            {props.account.number}
          </Text>
        </View>
        <Text className="min-w-0 flex-1 text-base font-t3-medium text-foreground" numberOfLines={1}>
          {props.account.account}
        </Text>
        {props.account.active ? (
          <Text className="text-xs font-t3-medium text-foreground-muted">Active</Text>
        ) : null}
      </View>
      <View className="flex-row flex-wrap gap-x-3 gap-y-1">
        <Text className="text-xs text-foreground-muted">{props.account.plan}</Text>
        <Text className="text-xs text-foreground-muted">5h {props.account.fiveHourUsage}</Text>
        <Text className="text-xs text-foreground-muted">Week {props.account.weeklyUsage}</Text>
        <Text className="text-xs text-foreground-muted">{props.account.lastActivity}</Text>
      </View>
      <Pressable
        accessibilityLabel={`Switch to ${props.account.account}`}
        accessibilityRole="button"
        disabled={props.disabled || props.account.active}
        onPress={props.onSwitch}
        className="self-start rounded-full bg-secondary px-3 py-2 disabled:opacity-40"
      >
        <Text className="text-xs font-t3-bold tracking-[0.6px] uppercase text-secondary-foreground">
          Switch
        </Text>
      </Pressable>
    </View>
  );
}

function ThresholdInput(props: {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
}) {
  return (
    <View className="flex-1 gap-1.5">
      <Text className="text-2xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
        {props.label}
      </Text>
      <TextInput
        keyboardType="number-pad"
        value={props.value}
        onChangeText={props.onChangeText}
        className="rounded-[14px] border border-input-border bg-input px-4 py-3 text-base text-foreground"
      />
    </View>
  );
}
