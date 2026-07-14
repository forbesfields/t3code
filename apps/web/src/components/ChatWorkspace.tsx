import { type EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { PanelBottomIcon, PanelRightIcon, SplitIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { useMediaQuery } from "../hooks/useMediaQuery";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { Button } from "./ui/button";
import ChatView from "./ChatView";
import {
  clampSplitRatio,
  replaceFocusedPane,
  sameWorkspaceThread,
  type ChatWorkspaceLayout,
  type ChatWorkspaceOrientation,
  type ChatWorkspacePane,
  type ChatWorkspaceThreadRef,
} from "./ChatWorkspace.logic";

const CHAT_WORKSPACE_STORAGE_KEY = "t3code:chat-workspace:v1";
const CHAT_WORKSPACE_THREAD_REF = Schema.Struct({
  environmentId: Schema.String,
  threadId: Schema.String,
});
const CHAT_WORKSPACE_LAYOUT = Schema.Struct({
  orientation: Schema.Literals(["horizontal", "vertical"]),
  primary: CHAT_WORKSPACE_THREAD_REF,
  secondary: CHAT_WORKSPACE_THREAD_REF,
  ratio: Schema.Number,
  focusedPane: Schema.Literals(["primary", "secondary"]),
});
const CHAT_WORKSPACE_STORAGE = Schema.NullOr(CHAT_WORKSPACE_LAYOUT);

function asWorkspaceThread(ref: ScopedThreadRef): ChatWorkspaceThreadRef {
  return { environmentId: ref.environmentId, threadId: ref.threadId };
}

function asScopedThread(ref: ChatWorkspaceThreadRef): ScopedThreadRef {
  return {
    environmentId: ref.environmentId as EnvironmentId,
    threadId: ThreadId.make(ref.threadId),
  };
}

function normalizeLayout(layout: ChatWorkspaceLayout): ChatWorkspaceLayout {
  return { ...layout, ratio: clampSplitRatio(layout.ratio) };
}

interface ChatWorkspaceProps {
  readonly threadRef: ScopedThreadRef;
  readonly onNavigate: (threadRef: ScopedThreadRef) => void;
}

interface ChatPaneProps {
  readonly threadRef: ChatWorkspaceThreadRef;
  readonly focused: boolean;
  readonly onFocus: () => void;
  readonly controls: React.ReactNode;
}

function ChatPane({ threadRef, focused, onFocus, controls }: ChatPaneProps) {
  const scopedThreadRef = useMemo(() => asScopedThread(threadRef), [threadRef]);
  return (
    <section
      className={`relative flex min-h-0 min-w-0 flex-1 overflow-hidden ${
        focused ? "ring-1 ring-inset ring-primary" : ""
      }`}
      onPointerDownCapture={onFocus}
    >
      <div className="absolute right-2 top-2 z-50 flex items-center gap-1">{controls}</div>
      <ChatView
        environmentId={scopedThreadRef.environmentId}
        threadId={scopedThreadRef.threadId}
        routeKind="server"
      />
    </section>
  );
}

export function ChatWorkspace({ threadRef, onNavigate }: ChatWorkspaceProps) {
  const [storedLayout, setStoredLayout] = useLocalStorage(
    CHAT_WORKSPACE_STORAGE_KEY,
    null,
    CHAT_WORKSPACE_STORAGE,
  );
  const layout = storedLayout ? normalizeLayout(storedLayout) : null;
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const isNarrow = useMediaQuery("(max-width: 900px)");
  const routeThread = useMemo(
    () => asWorkspaceThread(threadRef),
    [threadRef.environmentId, threadRef.threadId],
  );

  useEffect(() => {
    if (!layout) return;
    if (
      sameWorkspaceThread(layout.primary, routeThread) &&
      sameWorkspaceThread(layout.secondary, routeThread)
    ) {
      return;
    }
    if (sameWorkspaceThread(layout.primary, routeThread)) {
      if (layout.focusedPane !== "primary") setStoredLayout({ ...layout, focusedPane: "primary" });
      return;
    }
    if (sameWorkspaceThread(layout.secondary, routeThread)) {
      if (layout.focusedPane !== "secondary")
        setStoredLayout({ ...layout, focusedPane: "secondary" });
      return;
    }
    setStoredLayout(replaceFocusedPane(layout, routeThread));
  }, [layout, routeThread, setStoredLayout]);

  const focusPane = useCallback(
    (pane: ChatWorkspacePane, nextThread: ChatWorkspaceThreadRef) => {
      setStoredLayout((current) => (current ? { ...current, focusedPane: pane } : current));
      if (!sameWorkspaceThread(routeThread, nextThread)) {
        onNavigate(asScopedThread(nextThread));
      }
    },
    [onNavigate, routeThread, setStoredLayout],
  );

  const split = useCallback(
    (orientation: ChatWorkspaceOrientation) => {
      setStoredLayout({
        orientation,
        primary: routeThread,
        secondary: routeThread,
        ratio: 0.5,
        focusedPane: "secondary",
      });
    },
    [routeThread, setStoredLayout],
  );

  const closePane = useCallback(
    (pane: ChatWorkspacePane) => {
      if (!layout) return;
      const remaining = pane === "primary" ? layout.secondary : layout.primary;
      setStoredLayout(null);
      onNavigate(asScopedThread(remaining));
    },
    [layout, onNavigate, setStoredLayout],
  );

  const swapPanes = useCallback(() => {
    setStoredLayout((current) => {
      if (!current) return current;
      return {
        ...current,
        primary: current.secondary,
        secondary: current.primary,
        focusedPane: current.focusedPane === "primary" ? "secondary" : "primary",
      };
    });
  }, [setStoredLayout]);

  const resize = useCallback(
    (orientation: ChatWorkspaceOrientation, event: React.PointerEvent<HTMLDivElement>) => {
      const root = workspaceRef.current;
      if (!root) return;
      const bounds = root.getBoundingClientRect();
      const onMove = (moveEvent: PointerEvent) => {
        const ratio =
          orientation === "vertical"
            ? (moveEvent.clientX - bounds.left) / bounds.width
            : (moveEvent.clientY - bounds.top) / bounds.height;
        setStoredLayout((current) =>
          current ? { ...current, ratio: clampSplitRatio(ratio) } : current,
        );
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      event.preventDefault();
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    },
    [setStoredLayout],
  );

  const splitControls = (pane: ChatWorkspacePane) =>
    layout ? (
      <>
        <Button aria-label="Swap chat panes" onClick={swapPanes} size="icon-sm" variant="ghost">
          <SplitIcon />
        </Button>
        <Button
          aria-label="Close chat pane"
          onClick={() => closePane(pane)}
          size="icon-sm"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </>
    ) : (
      <>
        <Button
          aria-label="Split chat right"
          onClick={() => split("vertical")}
          size="icon-sm"
          variant="ghost"
        >
          <PanelRightIcon />
        </Button>
        <Button
          aria-label="Split chat down"
          onClick={() => split("horizontal")}
          size="icon-sm"
          variant="ghost"
        >
          <PanelBottomIcon />
        </Button>
      </>
    );

  if (!layout) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <ChatPane
          controls={splitControls("primary")}
          focused
          onFocus={() => undefined}
          threadRef={routeThread}
        />
      </div>
    );
  }

  const focusedThread = layout.focusedPane === "primary" ? layout.primary : layout.secondary;
  const otherThread = layout.focusedPane === "primary" ? layout.secondary : layout.primary;
  if (isNarrow) {
    return (
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="absolute left-2 top-2 z-50">
          <Button
            aria-label="Show other chat pane"
            onClick={() =>
              focusPane(layout.focusedPane === "primary" ? "secondary" : "primary", otherThread)
            }
            size="sm"
            variant="secondary"
          >
            Other chat
          </Button>
        </div>
        <ChatPane
          controls={splitControls(layout.focusedPane)}
          focused
          onFocus={() => focusPane(layout.focusedPane, focusedThread)}
          threadRef={focusedThread}
        />
      </div>
    );
  }

  const isVertical = layout.orientation === "vertical";
  return (
    <div
      className={
        isVertical ? "flex min-h-0 min-w-0 flex-1" : "flex min-h-0 min-w-0 flex-1 flex-col"
      }
      ref={workspaceRef}
    >
      <div
        style={
          isVertical ? { width: `${layout.ratio * 100}%` } : { height: `${layout.ratio * 100}%` }
        }
        className="flex min-h-0 min-w-0"
      >
        <ChatPane
          controls={splitControls("primary")}
          focused={layout.focusedPane === "primary"}
          onFocus={() => focusPane("primary", layout.primary)}
          threadRef={layout.primary}
        />
      </div>
      <div
        aria-label={isVertical ? "Resize chat panes horizontally" : "Resize chat panes vertically"}
        className={
          isVertical
            ? "z-40 w-1 shrink-0 cursor-col-resize bg-border hover:bg-primary"
            : "z-40 h-1 shrink-0 cursor-row-resize bg-border hover:bg-primary"
        }
        onPointerDown={(event) => resize(layout.orientation, event)}
        role="separator"
      />
      <div className="flex min-h-0 min-w-0 flex-1">
        <ChatPane
          controls={splitControls("secondary")}
          focused={layout.focusedPane === "secondary"}
          onFocus={() => focusPane("secondary", layout.secondary)}
          threadRef={layout.secondary}
        />
      </div>
    </div>
  );
}
