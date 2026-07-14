export type ChatWorkspacePane = "primary" | "secondary";
export type ChatWorkspaceOrientation = "horizontal" | "vertical";

export interface ChatWorkspaceThreadRef {
  readonly environmentId: string;
  readonly threadId: string;
}

export interface ChatWorkspaceLayout {
  readonly orientation: ChatWorkspaceOrientation;
  readonly primary: ChatWorkspaceThreadRef;
  readonly secondary: ChatWorkspaceThreadRef;
  readonly ratio: number;
  readonly focusedPane: ChatWorkspacePane;
}

export function clampSplitRatio(value: number): number {
  return Math.min(0.75, Math.max(0.25, value));
}

export function sameWorkspaceThread(
  left: ChatWorkspaceThreadRef,
  right: ChatWorkspaceThreadRef,
): boolean {
  return left.environmentId === right.environmentId && left.threadId === right.threadId;
}

export function replaceFocusedPane(
  layout: ChatWorkspaceLayout,
  thread: ChatWorkspaceThreadRef,
): ChatWorkspaceLayout {
  return layout.focusedPane === "primary"
    ? { ...layout, primary: thread }
    : { ...layout, secondary: thread };
}
