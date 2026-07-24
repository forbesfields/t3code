import { describe, expect, it } from "vite-plus/test";

import { migrationEntries } from "./Migrations.ts";

describe("migrationEntries", () => {
  it("keeps custom advisor and settlement migrations compatible with Nightly databases", () => {
    expect(migrationEntries.slice(-2).map(([id, name]) => [id, name])).toEqual([
      [33, "ProjectionThreadAdvisor"],
      [35, "ProjectionThreadsSettled"],
    ]);
    expect(new Set(migrationEntries.map(([id]) => id)).size).toBe(migrationEntries.length);
  });
});
