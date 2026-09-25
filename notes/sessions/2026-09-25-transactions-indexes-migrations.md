# 2026-09-25 · Transactions, indexes, migrations

> **Branch:** `transactions` · **Course:** videos 30–32 · **Notes:** [11 Transactions](../11-transactions.md) · [12 Indexes & Migrations](../12-indexes-migrations.md)

## What this session was

Watched all three videos without coding along. The course covers them very briefly (video 31 is about two
minutes), so the notes go well past what the videos say: these three topics are where real production
problems live.

## The three ideas, short

- **Transaction** = "apply all of these writes, or none". Without one, a crash between two writes leaves data
  that contradicts itself (counter says 6, event log says 5) and nothing says which is right.
- **Index** = a sorted lookup structure for one or more columns. Without it the database reads every row.
- **Migration** = a small, reviewed, committed file describing one schema change, in both directions.
  It replaces `synchronize: true`, which changes the database by dropping and recreating things.

## Measured, not guessed

Ran this in our own Postgres container, 500,000 rows, looking up one row by name:

| | Plan | Time |
|---|---|---|
| no index | `Seq Scan`, "Rows Removed by Filter: 166666" per worker | **14.603 ms** |
| with index | `Index Scan using idx_demo_name` | **0.045 ms** |

~325× faster. Cost: the index is **15 MB** against a **25 MB** table, and every write has to maintain it.
`EXPLAIN ANALYZE` is the tool: it tells you whether the database read everything or looked it up.

## Things worth remembering

- A transaction lives on **one connection**. Repositories grab any free connection from the pool, so inside a
  transaction everything must go through `queryRunner.manager`, or your rollback silently keeps half the data.
- `release()` belongs in `finally`. Forget it and each call leaks a connection until the app hangs with no error.
- **A transaction is not a lock.** Two people recommending the same coffee can both read 5 and write 6. If the
  new value depends on the old, let the database do the arithmetic (`recommendations + 1`).
- The course injects `Connection`; our TypeORM version uses **`DataSource`**, and it needs no decorator.
- `synchronize: true` renaming a column = **drop the old one with its data**, then create an empty new one.
  We already saw it happen when the json `flavor` column disappeared in the relations session.
- `migration:generate` writes a **draft**. For a rename it produces drop + create; you replace that with
  `RENAME COLUMN` by hand. Reading the generated file is the whole safety step.
- Multi-column index order matters: `(name, type)` doesn't help a query that filters only on `type`.

## Still open

1. Build the video-30 feature for real: `Event` entity, `recommendations` column, `recommendCoffee()` in a
   transaction. Practice tasks are in [note 11](../11-transactions.md) (including forcing a rollback and
   deliberately leaking the pool).
2. Practice tasks in [note 12](../12-indexes-migrations.md): reproduce the seq scan, do the dangerous rename
   on purpose, then do it properly with a migration.
3. Pagination holes from the last session are still there (`?offset=0` rejected, no max `limit`).

## Next

Video 33: dependency injection deep dive. New branch.
