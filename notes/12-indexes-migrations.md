# 12 — Indexes & Migrations

> 📍 **Where on the Big Map:** the database layer. Indexes make reads fast; migrations change the table shape without losing data.
> 📘 **Official course:** video31 Adding Indexes · video32 Setting up Migrations (both are short in the course; this note goes further, because both matter a lot)
> 🌿 Branch: `transactions`

---

# Part A — Indexes

## 1. The problem

Once the `Event` entity from video 30 exists, analytics will ask it questions like this one:

```sql
SELECT * FROM event WHERE name = 'recommend_coffee';
```

How does the database find those rows? The naive answer is the only one it has if nobody has told it anything else: **read every row in the table and check each one.** 10,000 rows: fine. 5 million rows: your endpoint takes seconds, and it gets worse every week as data grows, without a single line of your code changing.

To see it rather than imagine it, I made a throwaway table with **500,000 rows** in your Postgres container (2026-09-25) and asked for one row by name. This is what Postgres reported it did:

```
Parallel Seq Scan on idx_demo
  Filter: (name = 'user499999')
  Rows Removed by Filter: 166666      ← per worker; 500,000 rows read in total
Execution Time: 14.603 ms
```

"Seq Scan" is Postgres saying "I read the whole table". "Rows Removed by Filter" is the count of rows it looked at and threw away to find the one you wanted.

## 2. Mental model

It's the difference between finding a word in a book by starting at page 1, and using the index at the back: a short, sorted list of words, each with the page numbers it appears on.

In JavaScript terms, it's the difference between these two:

```js
users.find((u) => u.name === 'user499999');   // walks the array: 500,000 comparisons worst case
usersByName.get('user499999');                // a Map: straight to it
```

The `Map` didn't make the array smaller. It's a **second structure, kept next to the data, that costs memory and has to be updated on every insert**, so that lookups by one key stop being a walk. A database index is that Map, with one difference: it is kept sorted, so it also answers "everything between A and B" and "sorted by name" cheaply.

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

## 3. Baby steps

### 3.1 Naive: the query with nothing else

That's section 1. The query is correct, the result is correct, and it took 14.603 ms to read 500,000 rows to return one. On a laptop with the table in memory that feels fine. On a server with a table ten times bigger, on disk, with a hundred users asking at once, it is the endpoint everyone complains about.

### 3.2 Better: tell the database to keep a sorted lookup for that column

One statement:

```sql
CREATE INDEX idx_demo_name ON idx_demo (name);
```

Same query, same data, measured again:

```
Index Scan using idx_demo_name on idx_demo
  Index Cond: (name = 'user499999')
Execution Time: 0.045 ms
```

**14.6 ms → 0.045 ms. About 325× faster.** The plan even tells you what changed: *Seq Scan* ("I read the whole table") became *Index Scan* ("I looked it up"). Nothing in the query changed; the database found a better way to run it, because you gave it one.

### 3.3 What's still wrong: it isn't free, and the wrong one does nothing

The cost of that speed, from the same experiment:

```
table: 25 MB      index: 15 MB
```

A 15 MB structure to speed up one column of a 25 MB table. And it's not only disk:

| Cost | Why |
|---|---|
| Disk and memory | Our example: 15 MB of index for a 25 MB table |
| Slower writes | Every `INSERT`/`UPDATE`/`DELETE` must also update every index on that table |
| Wrong ones are useless | An index on a column nobody filters by is pure cost |

And an index only helps a query that can use it. Three ways to have the index and still get the Seq Scan:

- The query wraps the column in a function: `WHERE lower(email) = 'a@b.c'`. The index holds `email`, not `lower(email)`, so it can't be used. You'd need an index built on `lower(email)`.
- The query starts with a wildcard: `WHERE name LIKE '%9999'`. A sorted list of names can't help you find "things that *end* with 9999" (practice task 2 lets you watch this happen).
- The column has two possible values (`isActive`). Half the table matches; reading half the table through an index is slower than reading the table, so the planner ignores it.

### 3.4 What a senior does: measure, index what's searched, and know the shape

**Measure first.** `EXPLAIN ANALYZE` in front of a query makes Postgres run it and report what it did. Seq Scan or Index Scan, how many rows it removed, how long it took. Guessing which index to add is how tables end up with fourteen of them.

**Index what you actually search, sort or join by.** Foreign keys, `email` on users, `createdAt` if you sort by it, `name` on `event` because analytics filters by it. Not "every column, to be safe".

**Write it where the column is.** In the entity, so it's part of the schema and travels with the code:

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

**Know that order matters in a multi-column index.** `(name, type)` helps queries that filter on `name`, or on `name` *and* `type`. It does **not** help a query that filters only on `type`. Think of a phone book sorted by surname then first name: useless for finding everyone called "Ali".

**Know what you already have.** Every primary key gets an index automatically (that's how `WHERE id = 5` is instant), and so does every unique constraint. Section 6 shows the ones already in our database.

**Know how to add one to a live table.** Building an index reads the whole table and, done the plain way, blocks writes while it does. Production uses `CREATE INDEX CONCURRENTLY`, which is slower to build but lets writes continue, and it can't run inside a transaction, which matters in Part B.

**The names, at the end:** the sorted side structure is an **index**. The shape Postgres uses for it by default is a **B-tree**, a balanced tree where every step halves what's left to search, which is why a million rows costs roughly 20 steps instead of a million. That word appears in our `\d` output as `btree`.

## 4. How it works underneath

### 4.1 The ten lines the index is doing

An index is a sorted list of `(value, where-the-row-is)` pairs, searched by halving. You could write it:

```js
// what an index on `name` is, roughly
const index = rows
  .map((row, i) => ({ key: row.name, rowId: i }))
  .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));   // built once, kept sorted on every insert

function lookup(key) {                         // Index Scan
  let lo = 0, hi = index.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (index[mid].key === key) return rows[index[mid].rowId];
    if (index[mid].key < key) lo = mid + 1; else hi = mid - 1;
  }
  return null;
}
// versus:  rows.find((r) => r.name === key)   // Seq Scan
```

500,000 entries, halved each step: 2^19 ≈ 524,288, so about 19 comparisons instead of 500,000. That ratio is the 14.6 ms → 0.045 ms from section 3. The real B-tree is this idea arranged in pages on disk so that each step is one page read, and kept balanced as rows arrive, so it never degrades into a long chain.

### 4.2 From `@Index()` to `Index Scan`, file by file

```
 src/.../event.entity.ts      @Index() on `name`
        │                     (a decorator: attaches a note "index: name" to the class, note 03)
        ▼
 app.module.ts  forRoot({ synchronize: true })      →  at startup: CREATE INDEX "IDX_..." ON "event" ("name")
        │                                              (Part B: in real projects this line lives in a migration instead)
        ▼
 Postgres  keeps the btree up to date on every INSERT / UPDATE / DELETE to `event`
        │
        ▼
 a query arrives:  SELECT * FROM event WHERE name = $1
        │
        ▼
 the planner  looks at the table's statistics (gathered by ANALYZE: how many rows, how many distinct names)
        │     and estimates the cost of each way to run it:
        │        Seq Scan:   read all N rows
        │        Index Scan: ~log2(N) index steps + fetch the matching rows
        ▼
 the cheaper plan runs.  EXPLAIN ANALYZE shows you which one it picked, and how long it took.
```

The planner step is why the "two possible values" case in 3.3 ignores your index: the statistics say half the rows match, the cost estimate for the index path comes out higher, and the Seq Scan wins. It is also why `ANALYZE` appears in the practice SQL: without fresh statistics, the planner is guessing.

## 5. Functional vs class

The index itself has no class; it is a `CREATE INDEX` statement. The question is where that statement lives.

```sql
-- plain SQL, run by hand or from a migration file
CREATE INDEX idx_event_name ON event (name);
```

```ts
// on the entity class
@Index()
@Column()
name: string;
```

The plain-SQL version is honest: you see exactly what will be built and you run it when you choose (with `CONCURRENTLY` on a live table). The decorator version buys **locality**: the index sits on the line of the column it's about, so a reader of `event.entity.ts` learns "this column is searched" without opening another file, and `migration:generate` (Part B) can turn the decorator into the `CREATE INDEX` for you. What it costs: the statement is hidden. With `synchronize: true` it runs at startup, with the plain (write-blocking) form, on whatever table size happens to be there. On a laptop that's nothing; on a big production table it is exactly the case senior engineers handle by hand. Pick the decorator for the description, and let a reviewed migration decide how and when it actually runs.

## 6. In my project

The `Event` entity isn't built yet (practice task 3, and note 11 practice task 1). But the database already has indexes we never asked for, and they're worth looking at. From `\d` on our three tables (2026-09-25):

```
coffee:          "PK_4d27239ee0b99a491ad806aec46" PRIMARY KEY, btree (id)
flavor:          "PK_934fe79b3d8131395c29a040ee5" PRIMARY KEY, btree (id)
coffee_flavors:  "PK_cf9835ad2a5149c5d780194e556" PRIMARY KEY, btree ("coffeeId", "flavorId")
                 "IDX_1261799af4d50c583a441518d0" btree ("flavorId")
                 "IDX_e02a91775041bbe3bd6638e4d5" btree ("coffeeId")
```

Three things to read off that:

- Every primary key is a `btree` index. That's why `findOne({ where: { id } })` (`src/coffee/coffee.service.ts:118`) is a lookup, not a scan.
- TypeORM added an index on **each foreign-key column** of the join table on its own. Following a coffee to its flavors, or a flavor to its coffees (the two `LEFT JOIN`s in note 10 §4.2), uses them. Postgres does not do this by itself; "forgot to index the foreign key" is a classic slow join on tables you build by hand.
- The pair index `("coffeeId", "flavorId")` is a multi-column index, so per section 3.4 it helps "by coffee" and "by coffee and flavor" but not "by flavor alone". That's what the separate `("flavorId")` index is for.

The 500k-row measurement in sections 1–3 was done on a throwaway table `idx_demo` in this same container; it has since been dropped. The practice SQL below rebuilds it so you can see the numbers on your own machine.

| What | Where |
|---|---|
| The `synchronize: true` that turned the decorators into these `CREATE INDEX` statements | `src/app.module.ts:78` |
| The `@ManyToMany` / `@JoinTable` that produced the join table and its indexes | `src/coffee/entity/coffee.entity.ts:85-87` |
| Where `@Index()` on `name` will go when `Event` exists | `src/coffee/entity/event.entity.ts` (to be created) |

## 7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| Index every column | All the write cost and disk, none of the benefit; every insert maintains every one of them | Every user of the write path, and whoever pays the disk bill |
| Add indexes by guessing | The one you added isn't the one the planner wants; the slow query stays slow and writes got slower anyway. `EXPLAIN ANALYZE` tells you what the database really does | You, twice: once adding it, once removing it |
| Index a column with two possible values (`isActive`) | The planner ignores it: reading half the table via an index is slower than reading the table | Nobody directly; the index is dead weight forever |
| Forget indexes on foreign keys | Joins and "delete parent" checks scan the child table. TypeORM did it for our join table; tables you create by hand won't have them | Every list endpoint with a relation, as the child table grows |
| Wrap the column in a function (`WHERE lower(email) = ...`) | A plain index on `email` can't be used; you need an index on `lower(email)` | The login endpoint, at exactly the moment traffic peaks |
| Create indexes on a live table without care | The plain `CREATE INDEX` blocks writes for as long as the build takes. Production uses `CREATE INDEX CONCURRENTLY` | Every user trying to write during the build, and whoever ran it at 2pm |
| Trust a fast query on 50 dev rows | Every query is fast on 50 rows. The Seq Scan only shows up with realistic data | The on-call engineer, six months later, when the table is big enough |

## 8. 🧠 Senior engineer lens

- **Measure, then index.** `EXPLAIN ANALYZE` is a tool you run before and after, not a tool you learn during an outage. Keep realistic data volumes somewhere you can test against; the 50-row dev database hides every scan.
- **Every index is a write tax.** Reads get cheaper, writes get more expensive, disk grows. A table written constantly and read rarely (an event log, an audit trail) wants few indexes; a table read constantly wants the ones its queries use. Know which kind each table is.
- **Column order in a multi-column index is a design decision.** Put the column you always filter by first. A single index can serve several queries if you order it for them, and can serve none of them if you don't.
- **Adding an index is a schema change with an operational cost.** On a big table it's a migration (Part B) that uses `CONCURRENTLY`, outside a transaction, and probably at a quiet hour. "Add index" in a pull request deserves the question "how big is that table in production?"
- **Indexes are one of the few places where a one-line change is a 300× change.** That cuts both ways: the biggest performance wins you will ever ship are usually an index, and so are some of the worst regressions, when one gets dropped by accident.

## 9. 🔗 Connects to
- [09 — Database, Docker & TypeORM](09-database-docker-typeorm.md): the primary key that has always had an index, and the pool that slow scans tie up (§3.6)
- [10 — Relations](10-relations.md) §4.1–4.2: the join table's foreign-key indexes, and the `LEFT JOIN`s that use them
- [11 — Transactions](11-transactions.md): the `Event` table this part keeps talking about
- Part B below: how an index reaches production without `synchronize`

## 10. ✍️ In my own words
> _(write here)_

## 11. 🛠️ Practice (Part A)

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

<details><summary>Hints</summary>

- 1: `docker compose exec db psql -U postgres` gets you the prompt. The two "Execution Time" lines should differ by a couple of orders of magnitude; if they don't, check that the `CREATE INDEX` actually ran (`\d demo` lists it).
- 2: think about what a sorted list of names can and can't do for "ends with". Then try `LIKE 'user4999%'` (trailing wildcard) and compare.
- 3: `@Index()` goes directly above the `@Column()` of the property. After a restart, `\d event` should show a new `IDX_...` btree line. If you want the two-column version, it goes above `@Entity()` instead.

</details>

## 12. ❓ Quiz (Part A)

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

---

# Part B — Migrations

## 1. The problem

Right now your app changes the database to match your entities every time it starts, because of one line in `src/app.module.ts`:

```ts
synchronize: true,
```

That line is why the `coffee` table exists without anyone writing `CREATE TABLE`. It's also a loaded gun. Rename a column in the entity:

```ts
@Column() name: string;      →      @Column() title: string;
```

What TypeORM sees on the next start is not "a rename". It sees "there is no entity property called `name` any more, and there is a new one called `title`". So it does what that description says: **drop the `name` column, with every value in it**, then create an empty `title` column. Locally that's your three test coffees. On a real server that's every customer's data, gone, with no undo.

This already happened in this repo, in the relations session (2026-09-22): the moment `flavor` changed from a json column to a relation, the app restarted and the json column and everything in it disappeared. Nobody typed a `DROP`.

It also can't work for a team, even when nothing is dropped:

- You can't review a schema change before it happens; it happens on startup, on whichever machine starts first.
- Two developers change entities differently and each machine drifts from the others.
- There is no record of what changed, or how to go back.

## 2. Mental model

Git, again, but for the shape of the database. Your code has a history: small, named commits, each one a diff someone could read, applied in order, and any machine that pulls ends up in the same state. A migration is the same thing for tables and columns:

```
 src/migrations/                              Postgres, table "migrations"
 ├── 1727000000000-CreateEvent.ts             │ id | timestamp     | name
 ├── 1727100000000-IndexEventName.ts     ──►  │ 1  | 1727000000000 | CreateEvent1727000000000
 └── 1727200000000-RenameCoffeeName.ts        │ 2  | 1727100000000 | IndexEventName1727100000000
                                              (the third one hasn't run here yet)
     the history, in git                      which parts of it THIS database has applied
```

`migration:run` is `git pull` for the schema: apply whatever this database hasn't seen yet, in order, and record it.

## 3. Baby steps

### 3.1 Naive: let `synchronize: true` do it

That's section 1. Rename in the entity, restart, and the column is dropped and recreated empty. Quiz Q3 and practice task 4 are about watching it happen on purpose.

### 3.2 Better: turn `synchronize` off and change the table by hand

Set `synchronize: false`, then in `psql`:

```sql
ALTER TABLE "coffee" RENAME COLUMN "name" TO "title";
```

**`RENAME` keeps the data.** The database can rename in place; nothing is copied, nothing is lost. This is the statement `synchronize` should have run and never will, because it can't tell a rename from a drop-and-add.

**What's still wrong:** you did it on your machine. Your teammate pulls the entity change, starts the app, and gets errors about a missing `title` column, because nobody ran the `ALTER` on their database. Production has the same problem, at deploy time, at 2am. And in a month nobody remembers which statements were run where, or in what order.

### 3.3 Better: write the change down as a file, and let the tool generate it

Put the statement in a file that lives in git next to the entity change:

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

`up` = do it. `down` = undo it, when a deploy goes wrong at 2am. The `queryRunner` is the same object as in note 11: one connection, and by default the tool wraps the run in a transaction so a failing migration leaves nothing half-applied (where the database supports that; most `ALTER`s in Postgres do).

TypeORM can write the first draft for you. `migration:generate` compares your entities with the live database and emits the SQL it thinks is needed:

```bash
npx typeorm migration:generate src/migrations/CoffeeRefactor -d <path to your DataSource file>
```

**What's still wrong:** the generator has the same blind spot as `synchronize`. It only sees "old column gone, new column present", so for a rename it writes a drop and an add, roughly:

```ts
await queryRunner.query(`ALTER TABLE "coffee" DROP COLUMN "name"`);
await queryRunner.query(`ALTER TABLE "coffee" ADD "title" character varying NOT NULL`);
```

The data loss you were trying to avoid, now in a file with a respectable name. Run that in production and it's gone, and `down()` will recreate an empty column, not the values.

### 3.4 What a senior does: generate, read, fix, commit, run per environment

```
1. change the entity in your code
2. generate a migration     → a file with the SQL TypeORM thinks is needed
3. READ IT. fix it.         ← the important step
4. commit it with the code change
5. run it (locally, then in CI, then in production, before/with the deploy)
```

Step 3 is where you replace the `DROP` + `ADD` pair with the `RENAME` from 3.2. Generated migrations are a **draft**, not an answer. Step 4 is what makes the change reviewable: it arrives in a pull request as a diff somebody reads before it touches a database. Step 5 is the same file running everywhere in the same order, and the `migrations` table in each database recording what it has already applied, so running again does nothing.

The commands, as the installed TypeORM (1.1.1) actually takes them. The course's flags are older; `npx typeorm --help` is the truth for your version:

```bash
npx typeorm migration:create   src/migrations/CoffeeRefactor                 # empty file, you write the SQL; no -d needed
npx typeorm migration:generate src/migrations/CoffeeRefactor -d <DataSource> # compares entities to the DB and writes a draft
npx typeorm migration:run    -d <DataSource>                                  # apply pending ones, in a transaction by default
npx typeorm migration:revert -d <DataSource>                                  # undo the last one (its down())
npx typeorm migration:show   -d <DataSource>                                  # list them, with a mark for the ones already run
```

`-d` is required for anything that touches the database (checked against `npx typeorm migration:run --help` here, 2026-09-25). Two practical details the video mentions still hold:

- Migrations run **outside Nest**, using a separate config file (the `DataSource` file that `-d` points at), so they can't use anything Nest provides: no injected services, no `ConfigService`.
- They run against **compiled** files, so build first and point the DataSource at `dist/`.

**And one thing the course doesn't say, which is where the real skill is:** a deploy is not instant. For a while, old code and new code run at the same time against one database. A migration that renames `name` to `title` breaks every old server still asking for `name` until it's replaced. Risky changes go in **steps**, each safe with both versions live: add the new column → write to both → backfill old rows → switch reads → stop writing the old one → drop it. Several deploys, several small migrations, no moment where anything is broken. (This is called *expand and contract*.)

**The name:** a small, committed file describing one change to the database, in both directions, is a **migration**. It is your schema's version history, the way git is your code's.

## 4. How it works underneath

### 4.1 What `migration:run` is doing

```js
// roughly what `typeorm migration:run -d ./data-source.js` does
const dataSource = await import(process.argv.d).then((m) => m.default);  // your entities + migrations list
await dataSource.initialize();

await db.query(`CREATE TABLE IF NOT EXISTS "migrations" (id serial, timestamp bigint, name varchar)`);
const done = new Set((await db.query(`SELECT name FROM "migrations"`)).map((r) => r.name));

const pending = dataSource.migrations                       // every class in src/migrations/, compiled to dist/
  .filter((m) => !done.has(m.name))
  .sort((a, b) => a.timestamp - b.timestamp);              // the number in the filename decides the order

for (const migration of pending) {
  const qr = dataSource.createQueryRunner();               // note 11: one connection, held
  await qr.startTransaction();                             // BEGIN (the default; -t false turns it off)
  await migration.up(qr);                                  // your SQL
  await qr.query(`INSERT INTO "migrations" (timestamp, name) VALUES ($1, $2)`, [migration.timestamp, migration.name]);
  await qr.commitTransaction();                            // the change AND the bookkeeping row land together
  await qr.release();
}
```

The important line is the `INSERT` into `migrations` **inside the same transaction** as the change: either the column was renamed and the database remembers it, or neither happened. `migration:revert` is the mirror image: take the newest row in `migrations`, run that class's `down()`, delete the row.

### 4.2 The workflow, file by file

```
 you edit             src/coffee/entity/coffee.entity.ts       name → title
        │
        ▼
 generate             npx typeorm migration:generate src/migrations/CoffeeRefactor -d dist/data-source.js
        │             (compares the entity classes in dist/ with the live tables; writes a DRAFT)
        ▼
 you read & fix       src/migrations/1727…-CoffeeRefactor.ts    DROP+ADD  →  RENAME COLUMN
        │
        ▼
 git                  commit entity change + migration file together; pull request; review
        │
        ▼
 build                pnpm build      →  dist/migrations/1727…-CoffeeRefactor.js
        │
        ▼
 run (each env)       npx typeorm migration:run -d dist/data-source.js
        │                 BEGIN → ALTER TABLE ... RENAME → INSERT INTO migrations → COMMIT
        ▼
 Postgres             coffee.title exists, data intact, migrations table has one more row
        │
        ▼
 deploy the app       new code reads `title`; old servers are drained (or the change was staged, section 3.4)
```

Every arrow after "you read & fix" is repeatable and identical on every machine. That's the property `synchronize: true` never had.

## 5. Functional vs class

A migration file is a class with two methods. The functional shape is an object with two functions, and some tools use exactly that:

```js
// functional / plain-object shape of the same migration
export default {
  name: 'CoffeeRefactor1234567890',
  up:   async (db) => db.query(`ALTER TABLE "coffee" RENAME COLUMN "name" TO "title"`),
  down: async (db) => db.query(`ALTER TABLE "coffee" RENAME COLUMN "title" TO "name"`),
};
```

```ts
// TypeORM's class shape
export class CoffeeRefactor1234567890 implements MigrationInterface {
  public async up(queryRunner: QueryRunner)   { ... }
  public async down(queryRunner: QueryRunner) { ... }
}
```

Same two functions. What the class version buys: the **class name is the migration's identity**. TypeORM reads `CoffeeRefactor1234567890` off the class, splits it into a name and a timestamp, stores that in the `migrations` table, and uses the timestamp to order the runs; the object version would need you to keep `name` and the filename in sync by hand. `implements MigrationInterface` also makes TypeScript refuse a file that forgot `down()`. What it costs: the `this`-free class is slightly odd to look at (nothing is ever stored on it), and the timestamp in the name is generated for you, so two developers generating on the same day get files that sort by who ran the command first, not by which change should go first. Rebase, and check the order.

## 6. In my project

Nothing is migrated yet; the repo is still on `synchronize: true`. What exists, and what the practice will change:

| What | Where |
|---|---|
| `synchronize: true`, with the comment warning about exactly the rename case | `src/app.module.ts:69-78` |
| The record of the json column that was dropped by `synchronize` in the relations session | `src/coffee/entity/coffee.entity.ts:54-55` (comment) |
| `src/migrations/` | does not exist yet (checked 2026-09-25); practice task 5 creates it |
| A `DataSource` file for the CLI (`-d`) | does not exist yet; it will hold the same connection options as `forRoot` |

Real output from the installed CLI (2026-09-25), so the flags in section 3.4 are the ones your machine accepts:

```
$ npx typeorm migration:run --help
  -d, --dataSource   Path to the file where your DataSource instance is defined.   [required]
  -t, --transaction  Indicates if transaction should be used or not for migration run. Enabled by default.
$ npx typeorm --help
  migration:create <path>     Creates a new migration file.
  migration:generate <path>   Generates a new migration file with sql needs to be executed to update schema.
  migration:revert            Reverts last executed migration.
  migration:run               Runs all pending migrations.
  migration:show              Show all migrations and whether they have been run or not
```

## 7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| `synchronize: true` anywhere but your own machine | It will drop a column with its data, with no warning and no undo | Every customer whose data was in that column |
| Run a generated migration without reading it | Rename → drop + create; "a bit of cleanup" → a dropped table | Same customers, and you, explaining it |
| Edit a migration that already ran somewhere | Other machines have recorded it as done and will skip your edit; databases drift apart. Write a new one | The teammate whose database is now different from yours in a way nobody can see |
| Delete data in a migration you can't undo | `down()` can restore a column's shape, never its contents | Whoever needs the rollback at 2am |
| One giant migration with ten unrelated changes | If it fails halfway you can't tell what state you're in. Small, focused files | The on-call engineer reading a half-applied schema |
| Ship a breaking change in one step | Old app code is still running during a deploy and errors on the renamed column until it's replaced | Every user hitting an old server during the rollout |
| Add a `NOT NULL` column with no default to a big table | Every existing row violates it, and the table may lock while it rewrites | Every user, for as long as the rewrite takes |
| Build an index in a migration the plain way on a big table | Writes block for the whole build (Part A §3.4). Use `CONCURRENTLY`, outside the transaction | Every user trying to write during the build |

## 8. 🧠 Senior engineer lens

- **A deploy is not instant.** For a while, old code and new code run at the same time against one database. That's why risky changes go in **steps**: add the new column → write to both → backfill old rows → switch reads → stop writing the old one → drop it. Several deploys, each safe on its own.
- **Backfills are their own job.** Changing the shape is quick; filling 50 million rows is not. Do it in batches, outside the migration, or the deploy hangs and locks the table.
- **`down()` is honest about limits.** It can undo structure, not deleted rows. Before anything destructive: a backup you have actually restored once.
- **Migrations are code review for your database.** The main value isn't the tooling, it's that a schema change arrives as a diff somebody reads before it touches production.
- **Indexes and migrations meet here:** adding an index on a big table is a migration that can lock writes. Production uses the concurrent version, outside a transaction.

## 9. 🔗 Connects to
- [09 — Database, Docker & TypeORM](09-database-docker-typeorm.md): where `synchronize: true` was introduced
- [10 — Relations](10-relations.md): the json column that got dropped when we added the relation, a live demo of §B.1
- [11 — Transactions](11-transactions.md): migrations run in transactions too (mostly), and `queryRunner` shows up again
- 19 — Testing: test databases get built by running migrations

## 10. ✍️ In my own words
> _(write here)_

## 11. 🛠️ Practice (Part B)

4. **Do the dangerous rename on purpose.** With `synchronize: true`, put a coffee in the database, rename
   `name` → `title` in the entity, restart, and look at the table. Where did the data go?
5. **Then do it properly:** turn `synchronize` off, write a migration with `RENAME COLUMN`, run it, and check
   the data survived. Then `migration:revert` and check again.

<details><summary>Hints</summary>

- 4: `select * from coffee;` before and after. Rename it back in the entity afterwards; the data won't come back, which is the lesson. Do it with a coffee you don't mind losing.
- 5: you'll need three things that don't exist yet: `synchronize: false`, a `src/migrations/` folder, and a small file exporting a `DataSource` with the same options as `forRoot` plus `migrations: ['dist/migrations/*.js']`. Build first, then `migration:run -d dist/<that file>.js`. `migration:show` tells you whether it thinks anything is pending. If `migration:generate` gives you `DROP` + `ADD`, that's section 3.3 happening to you; fix it before running.

</details>

## 12. ❓ Quiz (Part B)

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
