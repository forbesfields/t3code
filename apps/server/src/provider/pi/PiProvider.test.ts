import { describe, expect, it } from "@effect/vitest";

import { mapPiModels } from "./PiProvider.ts";

describe("mapPiModels", () => {
  it("keeps provider-qualified model ids and removes duplicates", () => {
    expect(
      mapPiModels([
        { provider: "openai", id: "gpt-5", name: "GPT-5" },
        { provider: "anthropic", id: "claude", name: "Claude" },
        { provider: "openai", id: "gpt-5", name: "Duplicate" },
      ]).map(({ slug, name, subProvider }) => ({ slug, name, subProvider })),
    ).toEqual([
      { slug: "openai/gpt-5", name: "GPT-5", subProvider: "openai" },
      { slug: "anthropic/claude", name: "Claude", subProvider: "anthropic" },
    ]);
  });
});
