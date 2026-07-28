import type { OrchestrationProposedPlan } from "@t3tools/contracts";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { Markdown } from "react-native-nitro-markdown";

import { AppText as Text } from "../../components/AppText";

function planTitle(planMarkdown: string): string {
  const match = /^#\s+(.+)$/m.exec(planMarkdown);
  return match?.[1]?.trim() || "Proposed plan";
}

export function ProposedPlanCard(props: { readonly proposedPlan: OrchestrationProposedPlan }) {
  const [expanded, setExpanded] = useState(false);
  const title = useMemo(
    () => planTitle(props.proposedPlan.planMarkdown),
    [props.proposedPlan.planMarkdown],
  );
  const preview =
    props.proposedPlan.planMarkdown.length > 900 && !expanded
      ? `${props.proposedPlan.planMarkdown.slice(0, 900).trimEnd()}…`
      : props.proposedPlan.planMarkdown;

  return (
    <View className="gap-3 rounded-[20px] border border-neutral-200 bg-neutral-50/90 p-4 dark:border-white/8 dark:bg-neutral-900/70">
      <View className="gap-1">
        <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-violet-700 dark:text-violet-300">
          Proposed plan
        </Text>
        <Text className="font-t3-bold text-lg text-neutral-950 dark:text-neutral-50">{title}</Text>
        <Text className="text-xs text-neutral-500 dark:text-neutral-400">
          {props.proposedPlan.status === "ready"
            ? "Ready to implement from your laptop or phone."
            : `Status: ${props.proposedPlan.status}`}
        </Text>
      </View>
      <Markdown>{preview}</Markdown>
      {props.proposedPlan.planMarkdown.length > 900 ? (
        <Pressable onPress={() => setExpanded((current) => !current)}>
          <Text className="text-sm font-t3-bold text-sky-700 dark:text-sky-300">
            {expanded ? "Show less" : "Show full plan"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
