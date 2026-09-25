# 12 — Indexes & Migrations

> 📍 **Where on the Big Map:** the database layer. Indexes make reads fast; migrations change the table shape without losing data.
> 📘 **Official course:** video31 Adding Indexes · video32 Setting up Migrations (both are short in the course; this note goes further, because both matter a lot)
> 🌿 Branch: `transactions`

---

# Part A — Indexes

## 1. The problem

```sql
SELECT * FROM event WHERE name = 'recommend_coffee';
```

How does the database find those rows? If there's no index, it **reads every row in the table and checks each one**.
10,000 rows: fine. 5 million rows: your endpoint takes seconds, and it gets worse every week as data grows.

It's the difference between finding a word in a book by starting at page 1, and using the index at the back.

## 2. Measured in our own database

I made a table with **500,000 rows** in your Postgres container and asked for one row by name.

**Without an index:**
```
Parallel Seq Scan on idx_demo
  Filter: (name = 'user499999')
  Rows Removed by Filter: 166666      ← per worker; 500,000 rows read in total
Execution Time: 14.603 ms
```

**After `CREATE INDEX idx_demo_name ON idx_demo (name);`:**
```
Index Scan using idx_demo_name on idx_demo
  Index Cond: (name = 'user499999')
Execution Time: 0.045 ms
```

**14.6 ms → 0.045 ms. About 325× faster**, same query, same data. The plan even tells you what it did:
*Seq Scan* = "I read the whole table". *Index Scan* = "I looked it up".

And the cost of that speed:
```
table: 25 MB      index: 15 MB
```

## 3. What an index actually is

A second, sorted structure that stores **just that column plus a pointer to the row**:

```
 table "event" (stored in whatever order rows arrived)
  id | name              | payload
  1  | recommend_coffee  | {...}
  2  | coffee_created    | {...}
  3  | recommend_coffee  | {...}

 index on (name)  — kept sorted, so the database can jump straight to a value
  coffee_created    → row 2
  recommend_coffee  → row 1, row 3
```

Sorted means it never has to read everything: it halves the search space at each step (a **B-tree**).
That's why a million rows costs roughly 20 steps instead of a million.

**Writing it in the entity:**

```ts
@Entity()
export class Event {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()                       // one column
  @Column()
  name: string;

  @Column({ type: 'json' })
  payload: Record<string, any>;
}

@Index(['name', 'type'])         // on the class = one index covering two columns together
@Entity()
export class Event { ... }
```

**Order matters in a multi-column index.** `(name, type)` helps queries that filter on `name`, or on
`name` *and* `type`. It does **not** help a query that filters only on `type`. Think of a phone book sorted by
surname then first name: useless for finding everyone called "Ali".

**You already have indexes.** Every primary key gets one automatically (that's how `WHERE id = 5` is instant),
and so does every unique constraint.

## 4. The cost nobody mentions

Indexes are not free, which is why databases don't just index everything:

| Cost | Why |
|---|---|
| Disk and memory | Our example: 15 MB of index for a 25 MB table |
| Slower writes | Every `INSERT`/`UPDATE`/`DELETE` must also update every index on that table |
| Wrong ones are useless | An index on a column nobody filters by is pure cost |

So: **index what you actually search, sort or join by.** Foreign keys, `email` on users, `createdAt` if you
sort by it. Not "every column, to be safe".

## 5. ❌ How NOT to do it

| Don't | Why |
|---|---|
| Index every column | All the write cost and disk, none of the benefit |
| Add indexes by guessing | Measure first: `EXPLAIN ANALYZE` tells you what the database really does |
| Index a column with two possible values (`isActive`) | Reading half the table via an index is slower than just reading the table |
| Forget indexes on foreign keys | Joins and "delete parent" checks scan the child table |
| Wrap the column in a function (`WHERE lower(email) = ...`) | A plain index can't be used; you need an index on `lower(email)` |
| Create indexes on a live table without care | Building one locks writes; production uses `CREATE INDEX CONCURRENTLY` |
| Trust a fast query on 50 dev rows | Every query is fast on 50 rows. Test with realistic data |

---

# Part B — Migrations

## 1. The problem `synchronize: true` creates

Right now your app changes the database to match your entities at startup. Rename a column:

```ts
@Column() name: string;      →      @Column() title: string;
```

What TypeORM does: **drop the `name` column** (with every value in it), then create an empty `title`.
Locally that's your three test coffees. On a real server that's every customer's data, gone, with no undo.

It also can't work for a team:
- You can't review a schema change before it happens; it just happens on startup.
- Two developers change entities differently and each machine drifts.
- There's no record of what changed, or how to go back.

This is why every real project turns `synchronize` **off** and uses migrations.

## 2. What a migration is

**A small file that describes one change to the database, in both directions.** You write it, commit it to git,
and run it. It's your schema's version history, exactly like git is your code's.

```ts
export class CoffeeRefactor1234567890 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "coffee" RENAME COLUMN "name" TO "title"`);
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "coffee" RENAME COLUMN "title" TO "name"`);
  }
}
```

`up` = do it. `down` = undo it, when a deploy goes wrong at 2am.

**`RENAME` keeps the data.** That's the whole point: `synchronize` would have dropped and recreated the column
and thrown the values away. The database can rename in place; nothing is copied, nothing is lost.

TypeORM keeps a `migrations` table listing which files have already run, so running them again does nothing.

## 3. The workflow

```
1. change the entity in your code
2. generate a migration     → a file with the SQL TypeORM thinks is needed
3. READ IT. fix it.         ← the important step (see below)
4. commit it with the code change
5. run it (locally, then in CI, then in production, before/with the deploy)
```

Commands (from the course; exact flags differ between TypeORM versions, check `npx typeorm --help`):

```bash
npx typeorm migration:create   src/migrations/CoffeeRefactor    # empty file, you write the SQL
npx typeorm migration:generate src/migrations/CoffeeRefactor    # compares entities to the DB and writes SQL for you
npx typeorm migration:run                                       # apply pending ones
npx typeorm migration:revert                                    # undo the last one
```

Two practical details the video mentions:
- Migrations run **outside Nest**, using a separate config file (`ormconfig.js` / a `DataSource` file), so
  they can't use anything Nest provides (no injected services, no `ConfigService`).
- They run against **compiled** files in `dist/`, so build first.

**Why step 3 matters:** `migration:generate` only sees "old column gone, new column present". It writes
`DROP COLUMN name; ADD COLUMN title;` — the data loss you were trying to avoid. You change it to a `RENAME`.
Generated migrations are a **draft**, not an answer.

## 4. ❌ How NOT to do it

| Don't | Why |
|---|---|
| `synchronize: true` anywhere but your own machine | It will drop a column with its data, with no warning and no undo |
| Run a generated migration without reading it | Rename → drop + create; "a bit of cleanup" → a dropped table |
| Edit a migration that already ran somewhere | Other machines have recorded it as done and will skip your edit. Write a new one |
| Delete data in a migration you can't undo | `down()` can restore a column's shape, never its contents |
| One giant migration with ten unrelated changes | If it fails halfway you can't tell what state you're in. Small, focused files |
| Ship a breaking change in one step | Old app code is still running during a deploy (see below) |
| Add a `NOT NULL` column with no default to a big table | Every existing row violates it, and the table may lock while it rewrites |

## 5. 🧠 Senior engineer lens

- **A deploy is not instant.** For a while, old code and new code run at the same time against one database.
  That's why risky changes go in **steps**: add the new column → write to both → backfill old rows →
  switch reads → stop writing the old one → drop it. Several deploys, each safe on its own.
- **Backfills are their own job.** Changing the shape is quick; filling 50 million rows is not. Do it in
  batches, outside the migration, or the deploy hangs and locks the table.
- **`down()` is honest about limits.** It can undo structure, not deleted rows. Before anything destructive:
  a backup you have actually restored once.
- **Migrations are code review for your database.** The main value isn't the tooling, it's that a schema change
  arrives as a diff somebody reads before it touches production.
- **Indexes and migrations meet here:** adding an index on a big table is a migration that can lock writes.
  Production uses the concurrent version, outside a transaction.

## 6. 🔗 Connects to
- [09 — Database, Docker & TypeORM](09-database-docker-typeorm.md): where `synchronize: true` was introduced
- [10 — Relations](10-relations.md): the json column that got dropped when we added the relation, a live demo of §B.1
- [11 — Transactions](11-transactions.md): migrations run in transactions too (mostly), and `queryRunner` shows up again
- 19 — Testing: test databases get built by running migrations

## 7. ✍️ In my own words
> _(write here)_

## 8. 🛠️ Practice

1. **See a seq scan yourself.** In `psql`:
   ```sql
   CREATE TABLE demo (id serial primary key, name text);
   INSERT INTO demo (name) SELECT 'user' || g FROM generate_series(1, 500000) g;
   ANALYZE demo;
   EXPLAIN ANALYZE SELECT * FROM demo WHERE name = 'user499999';
   CREATE INDEX demo_name_idx ON demo (name);
   ANALYZE demo;
   EXPLAIN ANALYZE SELECT * FROM demo WHERE name = 'user499999';
   ```
   Compare "Execution Time" and look for `Seq Scan` vs `Index Scan`. Drop the table afterwards.
2. **Watch an index not help.** With the same table, try `WHERE name LIKE '%9999'` (leading wildcard). Which plan now?
3. **Index the event name** with `@Index()` once you build the `Event` entity from video 30.
4. **Do the dangerous rename on purpose.** With `synchronize: true`, put a coffee in the database, rename
   `name` → `title` in the entity, restart, and look at the table. Where did the data go?
5. **Then do it properly:** turn `synchronize` off, write a migration with `RENAME COLUMN`, run it, and check
   the data survived. Then `migration:revert` and check again.

## 9. ❓ Quiz

**Q1.** `EXPLAIN ANALYZE` on a 500k-row table shows `Seq Scan ... Rows Removed by Filter: 499999`. What does that mean?

- A) The query used an index badly
- B) No usable index: the database read every row and threw away all but one
- C) The table needs vacuuming
- D) The query is fine, 500k rows is small

<details><summary>Answer</summary>

**B.** Measured in our own database: 14.6 ms without the index, 0.045 ms with it. "Rows Removed by Filter" is the tell.

</details>

**Q2.** A teammate adds `@Index()` to all 14 columns of a heavily-written table "for performance". What happens?

- A) Reads get faster, no downside
- B) Every insert and update now maintains 14 indexes, so writes slow down and disk use grows; indexes on columns nobody filters by are pure cost
- C) Postgres ignores the extra ones
- D) Only disk use changes

<details><summary>Answer</summary>

**B.** Index what you search, sort or join by. Our single index was 15 MB against a 25 MB table.

</details>

**Q3.** You rename `name` → `title` in the entity, with `synchronize: true`, on a database holding 10,000 coffees. What happens on restart?

- A) The column is renamed, data intact
- B) The `name` column is dropped with all its data, then an empty `title` column is created
- C) Startup fails and asks for a migration
- D) Both columns exist

<details><summary>Answer</summary>

**B.** This is the reason `synchronize` is dev-only, and the reason migrations exist. A migration would use
`ALTER TABLE ... RENAME COLUMN`, which keeps every value.

</details>

**Q4.** `migration:generate` produced `DROP COLUMN "name"; ADD COLUMN "title"`. You run it in production. What have you done, and what should you have done?

- A) Nothing wrong, that's a rename
- B) Deleted every value in that column. Generated migrations are drafts: read them and replace that pair with a `RENAME COLUMN`
- C) It's reversible with `down()`
- D) TypeORM would have refused

<details><summary>Answer</summary>

**B.** `down()` can recreate the column's shape, never its contents. The review step is the point.

</details>

**Q5.** A migration renames a column, and the deploy replaces app servers one at a time. What breaks?

- A) Nothing
- B) While both versions are live, the old code still queries the old column name and errors until it's replaced
- C) The migration fails
- D) Only the new servers break

<details><summary>Answer</summary>

**B.** Old and new code overlap during a deploy. Risky changes go in steps: add the new column, write to both,
backfill, switch reads, then drop the old one — several deploys, each safe alone.

</details>
