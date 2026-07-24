import type { OrchestrationAdvisorAction, OrchestrationAdvisorReview } from "@t3tools/contracts";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";

export function AdvisorReviewCard(props: {
  readonly review: OrchestrationAdvisorReview;
  readonly model?: string;
  readonly status?: string;
  readonly onAction: (action: OrchestrationAdvisorAction) => void;
  readonly responding?: boolean;
}) {
  const [expanded, setExpanded] = useState(
    props.status === "waiting_for_input" || props.review.verdict === "need_human",
  );
  const openBlockers = useMemo(
    () => props.review.blockers.filter((blocker) => blocker.status === "open"),
    [props.review.blockers],
  );
  const actionRequired = props.status === "waiting_for_input" || props.review.verdict === "need_human";

  return (
    <View
      className={`gap-3 rounded-[20px] border p-4 ${
        actionRequired
          ? "border-amber-400/50 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-950/20"
          : "border-neutral-200 bg-neutral-50/90 dark:border-white/8 dark:bg-neutral-900/70"
      }`}
    >
      <Pressable className="gap-1" onPress={() => setExpanded((current) => !current)}>
        <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-neutral-500 dark:text-neutral-400">
          {props.review.stage} orchestrator review
        </Text>
        <Text className="font-t3-bold text-lg text-neutral-950 dark:text-neutral-50">
          {props.review.verdict}
        </Text>
        <Text className="text-xs text-neutral-500 dark:text-neutral-400">
          {props.model ? `${props.model} · ` : ""}attempt {props.review.attempt}
        </Text>
      </Pressable>

      {expanded ? (
        <View className="gap-3">
          <View className="gap-1">
            <Text className="font-t3-bold text-sm text-neutral-950 dark:text-neutral-50">Evidence</Text>
            <Text className="text-sm text-neutral-600 dark:text-neutral-300">
              {props.review.evidenceSummary}
            </Text>
          </View>
          <View className="gap-1">
            <Text className="font-t3-bold text-sm text-neutral-950 dark:text-neutral-50">Assessment</Text>
            <Text className="text-sm text-neutral-600 dark:text-neutral-300">{props.review.summary}</Text>
          </View>
          {props.review.instruction ? (
            <View className="gap-1">
              <Text className="font-t3-bold text-sm text-neutral-950 dark:text-neutral-50">
                Worker instruction
              </Text>
              <Text className="text-sm text-neutral-600 dark:text-neutral-300">
                {props.review.instruction}
              </Text>
            </View>
          ) : null}
          {props.review.blockers.length > 0 ? (
            <View className="gap-2">
              <Text className="font-t3-bold text-sm text-neutral-950 dark:text-neutral-50">Blockers</Text>
              {props.review.blockers.map((blocker) => (
                <View
                  key={blocker.id}
                  className="rounded-xl bg-neutral-100 px-3 py-2 dark:bg-neutral-800/80"
                >
                  <Text className="font-t3-bold text-sm text-neutral-900 dark:text-neutral-100">
                    {blocker.requirement}
                  </Text>
                  <Text className="text-2xs uppercase text-neutral-500">{blocker.status}</Text>
                  <Text className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">
                    Evidence: {blocker.evidenceRequired}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {actionRequired ? (
        <View className="flex-row flex-wrap gap-2.5">
          <Pressable
            className="items-center justify-center rounded-[14px] bg-blue-500 px-3.5 py-3"
            disabled={props.responding}
            onPress={() => props.onAction("retry")}
          >
            <Text className="font-t3-extrabold text-sm text-white">Retry</Text>
          </Pressable>
          <Pressable
            className="items-center justify-center rounded-[14px] bg-neutral-200 px-3.5 py-3 dark:bg-neutral-800"
            disabled={props.responding}
            onPress={() => props.onAction("bypass")}
          >
            <Text className="font-t3-bold text-sm text-neutral-950 dark:text-neutral-50">
              Bypass once{openBlockers.length > 0 ? ` (${openBlockers.length})` : ""}
            </Text>
          </Pressable>
          <Pressable
            className="items-center justify-center rounded-[14px] bg-rose-100 px-3.5 py-3 dark:bg-rose-500/18"
            disabled={props.responding}
            onPress={() => props.onAction("stop")}
          >
            <Text className="font-t3-bold text-sm text-rose-700 dark:text-rose-300">Stop</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
