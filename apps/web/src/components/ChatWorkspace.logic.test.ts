import { describe, expect, it } from "vite-plus/test";

import { clampSplitRatio, replaceFocusedPane } from "./ChatWorkspace.logic";

describe("ChatWorkspace", () => {
  it("replaces the focused pane while keeping the other chat open", () => {
    const layout = replaceFocusedPane(
      {
        orientation: "vertical",
        primary: { environmentId: "local", threadId: "one" },
        secondary: { environmentId: "local", threadId: "two" },
        ratio: 0.5,
        focusedPane: "secondary",
      },
      { environmentId: "remote", threadId: "three" },
    );

    expect(layout).toMatchObject({
      primary: { environmentId: "local", threadId: "one" },
      secondary: { environmentId: "remote", threadId: "three" },
      focusedPane: "secondary",
    });
  });

  it("keeps resize ratios usable", () => {
    expect(clampSplitRatio(0.1)).toBe(0.25);
    expect(clampSplitRatio(0.8)).toBe(0.75);
  });
});
