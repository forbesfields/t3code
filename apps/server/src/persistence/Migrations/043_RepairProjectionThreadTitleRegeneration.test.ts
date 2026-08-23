import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("043_RepairProjectionThreadTitleRegeneration", (it) => {
  it.effect("repairs fork databases where migration 35 was already claimed", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 34 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (35, 'ProjectionThreadsSettled'),
          (42, 'ProjectionThreadAdvisor')
      `;
      yield* runMigrations();

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      const names = new Set(columns.map((column) => column.name));
      assert.ok(names.has("title_regeneration_request_id"));
      assert.ok(names.has("title_regeneration_started_at"));
    }),
  );
});
