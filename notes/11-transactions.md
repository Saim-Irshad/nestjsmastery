# 11 — Transactions: all of it, or none of it

> 📍 **Where on the Big Map:** the database layer, below the service. The service decides which writes belong together; the database makes sure they land together.
> 📘 **Official course:** video30 Use Transactions (videos 31 indexes and 32 migrations get their own note)
> 🌿 Branch: `transactions`

## 1. The problem

New feature: a user recommends a coffee. Two writes have to happen:

```
1. that coffee's `recommendations` count goes up by 1
2. a row goes into an `event` table, so analytics can see what happened
```

The naive version is the code you'd write first, and it looks completely reasonable:

```ts
// the obvious first draft of recommendCoffee(), in CoffeeService
async recommendCoffee(coffee: Coffee) {
  coffee.recommendations++;
  await this.coffeeRepositery.save(coffee);                              // write 1

  const event = this.eventRepositery.create({
    name: 'recommend_coffee', type: 'coffee', payload: { coffeeId: coffee.id },
  });
  await this.eventRepositery.save(event);                                // write 2
}
```

Two writes, one after the other. Between them there is a gap, and the gap is where the trouble lives:

```
UPDATE coffee ...  ✅
                   ← server crashes / database restarts / network drops / a bug throws
INSERT event ...   ❌ never runs
```

The counter says 6, the event log says 5, and **nothing in the data tells you which one is right**. Nobody notices for months. Then a report doesn't add up and there is no way to reconstruct the truth.

Same shape, with money:

```
UPDATE accounts SET balance = balance - 100 WHERE id = 1;   ✅ taken from A
                                                            ← crash
UPDATE accounts SET balance = balance + 100 WHERE id = 2;   ❌ never given to B
```

£100 has vanished. This is the classic example because the damage is obvious, but a broken counter is the same bug with a quieter outcome.

## 2. Mental model

Think of `git`. You edit five files, and until you run `git commit` none of it is part of the history. Commit, and all five land as one unit with one message. Change your mind, `git checkout .`, and all five edits disappear together. Nobody who pulls your repo ever sees three of the five files changed.

A database can be told to work the same way: "from here, nothing is final", then a list of statements, then "make it all real" or "forget all of it":

```
 ┌──────────────── one unit ────────────────┐
 │ BEGIN                                     │
 │   UPDATE coffee ...        (provisional)  │
 │   INSERT INTO event ...    (provisional)  │
 │ COMMIT   → both become real, together     │
 │   or                                      │
 │ ROLLBACK → both are forgotten, together   │
 └───────────────────────────────────────────┘
   another request looking in from outside sees "before" until COMMIT, then "after". Never the middle.
```

## 3. Baby steps

### 3.1 Naive: two saves in a row

That's the code in section 1. There's a detail that makes it worse than it looks: each `save()` is **already** its own unit. Logged from our own database in note 09 §3.4, one `repo.save()` runs `START TRANSACTION` → `INSERT` → `COMMIT`. So the naive version is really:

```
save(coffee):   START TRANSACTION  UPDATE coffee   COMMIT      ← unit 1, final
                                                                ← the gap
save(event):    START TRANSACTION  INSERT event    COMMIT      ← unit 2, final
```

Two units, each perfectly safe on its own, with a gap between them. The database did exactly what it was told. The bug is that it was told two things instead of one.

### 3.2 Better: catch the error and undo by hand

The first instinct is to clean up yourself:

```ts
async recommendCoffee(coffee: Coffee) {
  coffee.recommendations++;
  await this.coffeeRepositery.save(coffee);
  try {
    await this.eventRepositery.save(event);
  } catch (err) {
    coffee.recommendations--;                   // put it back
    await this.coffeeRepositery.save(coffee);   // ...hopefully
    throw err;
  }
}
```

**What's still wrong**, three things:

1. The undo is itself a write, and it can fail for the same reason the event write failed (database gone, network gone). Now you're writing an undo for the undo.
2. A `catch` only runs if your process is alive to run it. `kill -9`, an out-of-memory crash, the container restarting: none of them run your `catch`. The gap is still there.
3. For the milliseconds between the two writes, **another request can read the counter at 6 with no event to match**. Your cleanup can't take that back; someone already saw it.

You can't fix this from JavaScript, because the thing that needs to promise "all or nothing" is the thing that holds the data.

### 3.3 Better: ask the database to treat them as one unit

The database already knows how to do this. In plain SQL, typed into `psql`:

```sql
BEGIN;                                                       -- from here, nothing is final
UPDATE coffee SET recommendations = recommendations + 1 WHERE id = 5;
INSERT INTO event (name, type, payload) VALUES ('recommend_coffee', 'coffee', '{"coffeeId":5}');
COMMIT;                                                      -- now both are real, together
-- ROLLBACK instead of COMMIT → the database forgets everything since BEGIN
```

Here it is working against our own `coffee` table (2026-09-25). I changed a brand, looked at it from inside the unit, then threw the unit away:

```
postgres=# BEGIN;
BEGIN
postgres=# UPDATE coffee SET brand = 'CHANGED' WHERE id = 5;
UPDATE 1
postgres=# SELECT id, brand FROM coffee WHERE id = 5;
 id |  brand
----+---------
  5 | CHANGED        ← inside the unit, the change is visible to me
postgres=# ROLLBACK;
ROLLBACK
postgres=# SELECT id, brand FROM coffee WHERE id = 5;
 id | brand
----+-------
  5 | nest           ← after ROLLBACK, it never happened
```

Two things you get for free from the database, and could never build in JavaScript:

- Crash before `COMMIT`? The database throws the half-finished work away **by itself**, on restart. You don't clean up.
- Another request looking at the same rows **never sees the in-between state**. It sees "before" until you commit, then "after".

So the next draft is: send `BEGIN`, do the two saves with the repositories you already have, send `COMMIT`:

```ts
await this.coffeeRepositery.query('BEGIN');
await this.coffeeRepositery.save(coffee);
await this.eventRepositery.save(event);
await this.coffeeRepositery.query('COMMIT');
```

**What's still wrong:** this looks right and does nothing. A transaction lives on **one connection**, and your repositories don't have one. They borrow whatever connection is free from the pool (note 09 §3.6) for each call, so the four lines above can easily land on four different connections:

```
query('BEGIN')    ──► connection #7    BEGIN is now open on #7 and nobody else is using it
repo.save(coffee) ──► connection #3    its own START TRANSACTION … COMMIT, final immediately
repo.save(event)  ──► connection #5    same
query('COMMIT')   ──► connection #2    "there is no transaction in progress" (a warning, not an error)
```

Nothing errors. The two saves are as separate as they were in 3.1. This is the most common transaction bug, and the reason the real version looks the way it does.

### 3.4 What a senior does: hold one connection for the whole unit

Take one connection out of the pool, keep it for the whole job, run every statement through it, and give it back at the end no matter what:

```ts
const queryRunner = this.dataSource.createQueryRunner();

await queryRunner.connect();              // take ONE connection out of the pool and hold it
await queryRunner.startTransaction();     // BEGIN, on that connection
try {
  await queryRunner.manager.save(coffee);     // both writes go through THIS connection
  await queryRunner.manager.save(event);
  await queryRunner.commitTransaction();      // COMMIT
} catch (err) {
  await queryRunner.rollbackTransaction();    // ROLLBACK, undo everything since BEGIN
  throw err;                                  // let the error layer turn it into a response (note 05)
} finally {
  await queryRunner.release();                // give the connection back, success or failure
}
```

`createQueryRunner()` is you saying "give me one connection and let me keep it until I'm done". **Everything inside the transaction must go through `queryRunner.manager`**, because that manager is bound to that connection. `this.coffeeRepositery.save()` inside this block is the 3.3 bug again.

Here is the failing path, logged from our own database with `logging: true` (2026-09-25). I updated a brand through `queryRunner.manager`, then threw on purpose:

```
query: START TRANSACTION
query: UPDATE "coffee" SET "brand" = $1 WHERE "id" = $2 -- PARAMETERS: ["CHANGED",5]
query: ROLLBACK
caught: boom
query: SELECT ... FROM "coffee" "Coffee" WHERE (("Coffee"."id" = $1)) LIMIT 1 -- PARAMETERS: [5]
{"id":5,"name":"latte","brand":"nest"}                 ← the UPDATE never happened
```

And the happy path, same code without the `throw`:

```
query: START TRANSACTION
query: UPDATE "coffee" SET "brand" = $1 WHERE "id" = $2 -- PARAMETERS: ["nest",5]
query: COMMIT
```

**`release()` is not optional.** Forget it and that connection never goes back to the pool. On a busy endpoint the pool (10 connections by default) is empty after about ten requests, and the whole app hangs waiting for a free connection, with no error explaining why. That's why it's in `finally`: it runs whether you committed, rolled back, or threw something unexpected.

**Course vs your version:** the video injects `Connection`, the old TypeORM name. In the TypeORM installed here (1.1.1) `Connection` isn't exported at all; the class is `DataSource`. So the constructor becomes:

```ts
constructor(
  @InjectRepository(Coffee) private readonly coffeeRepositery: Repository<Coffee>,
  private readonly dataSource: DataSource,     // plain constructor param, no decorator
) {}
```

No `@InjectRepository` here because `DataSource` is a class that `TypeOrmModule.forRoot` registered for us, so its own name is enough for Nest to find it (note 03). Repositories need the extra label because `Repository<Coffee>` and `Repository<Flavor>` are the same class at runtime, so the name alone can't tell them apart.

**The name, now that you've seen it work:** a group of statements that land together or not at all is a **transaction**. `BEGIN`/`COMMIT`/`ROLLBACK` are the SQL; `startTransaction`/`commitTransaction`/`rollbackTransaction` are TypeORM's wrappers around them. The four promises a transaction makes, in plain words, with the interview names in brackets:

| Promise | Meaning |
|---|---|
| all-or-nothing (*atomicity*) | every statement lands, or none does |
| the rules still hold (*consistency*) | constraints and foreign keys are still enforced at commit |
| nobody sees half a job (*isolation*) | other requests see the before or the after, not the middle |
| committed means kept (*durability*) | once `COMMIT` returns, a power cut can't undo it |

### 3.5 ⚠️ What's still wrong: a transaction is not a lock

This is the part most people get wrong, including people who have been doing this for years. Two users recommend the same coffee at the same moment, and the code is the senior version from 3.4 with this in the middle:

```ts
coffee.recommendations++;        // read 5 in memory, write 6
await queryRunner.manager.save(coffee);
```

```
request A: reads 5 ──┐
request B: reads 5 ──┤ both write 6
                     ▼
result: 6 recommendations, but two people recommended  ← one vote silently lost
```

Both transactions are perfectly atomic, both commit, no error anywhere. **Atomic doesn't mean alone.** The read happened in your JavaScript, on a value that was already stale by the time you wrote it. This is the same lost-update race as note 04, one layer down: there it was a variable in memory, here it's a row.

Ways out, cheapest first:

- **Let the database do the arithmetic:** `UPDATE coffee SET recommendations = recommendations + 1 WHERE id = ?`. One statement, nothing read into JS, impossible to lose. In TypeORM: `queryRunner.manager.increment(Coffee, { id }, 'recommendations', 1)`.
- **Lock the row while you work:** `SELECT ... FOR UPDATE` makes the second transaction wait until the first commits, then it reads 6 and writes 7. (TypeORM: `.setLock('pessimistic_write')` on a query builder.) Correct, but now requests queue.
- **Check-and-retry:** a version number on the row; the update says `WHERE version = 5`, and if zero rows changed, someone got there first and you redo the work. (TypeORM: `@VersionColumn()`. The general name is *optimistic locking*.)

Rule of thumb: **if the new value depends on the old one, don't compute it in JavaScript.**

## 4. How it works underneath

### 4.1 What `queryRunner` is, in plain JS

Strip TypeORM away and a query runner is a client checked out of a pool, with the transaction commands sent as ordinary SQL:

```js
// roughly what createQueryRunner / connect / startTransaction / commit / release do
const pool = new Pool({ max: 10 });               // opened once, in forRoot (note 09 §3.6)

async function recommend(coffeeId) {
  const client = await pool.connect();            // queryRunner.connect(): one connection, held
  try {
    await client.query('BEGIN');                  // startTransaction()
    await client.query('UPDATE coffee SET recommendations = recommendations + 1 WHERE id = $1', [coffeeId]);
    await client.query('INSERT INTO event (name, type, payload) VALUES ($1, $2, $3)',
                       ['recommend_coffee', 'coffee', { coffeeId }]);
    await client.query('COMMIT');                 // commitTransaction()
  } catch (err) {
    await client.query('ROLLBACK');               // rollbackTransaction()
    throw err;
  } finally {
    client.release();                             // release(): back into the pool
  }
}
```

`queryRunner.manager` is that same `client`, wrapped so you can call `save`/`update`/`increment` on it instead of writing SQL. That is the whole trick: every statement goes down the same wire, so the database knows they belong to the `BEGIN` it saw on that wire.

### 4.2 How the database keeps the middle invisible

When you `UPDATE` a row inside a transaction, Postgres doesn't overwrite the row in place. It writes a **new version** of the row, tagged with your transaction's id, and leaves the old version where it was. Every other transaction that looks at that row is told "ignore versions from transactions that haven't committed", so it keeps seeing the old one. On `COMMIT`, your transaction is marked committed and the new version becomes the one everyone sees. On `ROLLBACK`, or on a crash, the tag never becomes "committed" and the new version is dead weight that gets cleaned up later.

That is why the `SELECT` inside the unit in section 3.3 showed `CHANGED` (it was *your* transaction asking) while anyone else would have seen `nest`, and why there is no "cleanup" for you to do after a crash: the abandoned versions were never visible in the first place. (The technique is called *MVCC*, multi-version concurrency control. The name doesn't matter; "old version stays until the new one is committed" does.)

### 4.3 The flow, file by file

```
 client  POST /coffee/5/recommend
   │
   ▼
 coffee.controller.ts        @Post(':id/recommend')  →  coffeeService.recommendCoffee(coffee)
   │
   ▼
 coffee.service.ts           const qr = this.dataSource.createQueryRunner()
   │                         await qr.connect()                 ─┐ pool: lend connection #7
   │                         await qr.startTransaction()        ─┤ #7: BEGIN
   │                         await qr.manager.save(coffee)      ─┤ #7: UPDATE coffee ...      (provisional)
   │                         await qr.manager.save(event)       ─┤ #7: INSERT INTO event ...  (provisional)
   │                         await qr.commitTransaction()       ─┤ #7: COMMIT                 (both final)
   │                         await qr.release()                 ─┘ pool: #7 free again
   ▼
 response  201
                                        on any throw between BEGIN and COMMIT:
                                          #7: ROLLBACK, release, rethrow → exception filter (note 05) → 4xx/5xx
```

Everything between `connect()` and `release()` is time that connection #7 is unavailable to every other request in the app. Keep that stretch short.

## 5. Functional vs class

The senior version in 3.4 lives inside a class method and reads `this.dataSource`, a field Nest filled in through the constructor. The functional shape of the same idea is a higher-order function: "run this callback inside a transaction, and handle begin/commit/rollback/release for me":

```js
// functional version: the transaction plumbing written once, as a wrapper
async function withTransaction(dataSource, work) {
  const qr = dataSource.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  try {
    const result = await work(qr.manager);     // the caller only writes the middle part
    await qr.commitTransaction();
    return result;
  } catch (err) {
    await qr.rollbackTransaction();
    throw err;
  } finally {
    await qr.release();
  }
}

// using it
await withTransaction(dataSource, async (manager) => {
  await manager.increment(Coffee, { id }, 'recommendations', 1);
  await manager.save(Event, event);
});
```

TypeORM ships exactly this wrapper: `this.dataSource.transaction(async (manager) => { ... })` (it is on `DataSource` in 1.1.1). The course shows the long form so you see every step; in real code the wrapper is what you'd reach for, because with it `release()` and `rollbackTransaction()` can't be forgotten. They're written once, in the wrapper, and tested once.

What the class version buys: the method sits next to the data it works on, `this.dataSource` arrives through Nest's wiring without you passing it around, and a reader of `CoffeeService` sees `recommendCoffee` beside `create` and `findAll`. What it costs: nothing forces the `try/catch/finally` shape, so every method that opens a transaction can get it slightly wrong. The senior move is both: a class method for the business logic, calling the functional wrapper for the plumbing.

## 6. In my project

The recommend feature is **not built yet**; it's practice task 1 below. What exists today, and where the new pieces go:

| What | Where |
|---|---|
| The current constructor: two repositories, no `DataSource` yet | `src/coffee/coffee.service.ts:43-49` |
| Where `private readonly dataSource: DataSource` will be added | same constructor |
| `TypeOrmModule.forRoot(...)`, which opens the pool that `createQueryRunner()` borrows from | `src/app.module.ts:57-79` |
| `forFeature([Coffee, Flavor])`, where `Event` will be added so its repository exists | `src/coffee/coffee.module.ts:23` |
| Where `recommendCoffee(coffee)` will live, next to `create` | `src/coffee/coffee.service.ts` |
| The route that will call it (`@Post(':id/recommend')`) | `src/coffee/coffee.controller.ts` |

Real output so far, all from 2026-09-25 against the Docker Postgres:

- the `psql` `BEGIN` / `UPDATE` / `SELECT` / `ROLLBACK` / `SELECT` round trip in section 3.3, showing the change visible inside the unit and gone after it;
- the TypeORM log in section 3.4 (`START TRANSACTION` → `UPDATE` → `ROLLBACK`, then the row unchanged), produced by running the compiled entities from `dist/coffee/entity/` with `logging: true` and the exact `queryRunner` shape from 3.4.

Once the feature is built, `logging: true` in `forRoot` will show the same three lines around your two saves, with `COMMIT` on success and `ROLLBACK` on failure.

## 7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| Use `this.repo.save()` inside a transaction | It runs on a different pooled connection, so it isn't in your transaction and won't roll back. No error, no warning | The user whose rollback silently kept half their data, and the analyst who finds the mismatch months later |
| Forget `release()` | The connection never returns to the pool. After about ten calls the pool is empty and every request in the app hangs, with no error in the logs | Everyone, on every endpoint, because the pool is shared |
| Forget `rollbackTransaction()` in the catch | The transaction stays open, holding its locks, until the connection times out. Other requests touching those rows queue behind it | Every user who touches the same coffee in the meantime |
| Swallow the error after rolling back | The client gets "success" for something that didn't happen | The user, who now believes their recommendation counted |
| Call an external API inside a transaction | The connection is held for as long as Stripe takes to answer. Do the outside work, then open a short transaction | Every user sharing the pool, and you when Stripe has a slow day |
| Wrap a whole request in a transaction to be safe | Long transactions hold locks and connections; they're how one slow endpoint takes down everything | The whole app, at peak traffic |
| Assume a transaction stops concurrent updates | It doesn't (section 3.5). Atomic doesn't mean alone. Two readers of `5` both write `6` | The second user, whose vote vanished with no trace |
| Reach for a transaction for a single statement | One statement is already all-or-nothing on its own. Extra ceremony, no extra safety | Whoever reads the code and assumes there's a reason |

## 8. 🧠 Senior engineer lens

- **Ask "must these happen together?"** If yes, one transaction. Money, inventory, "create user + create their default workspace", "mark paid + write receipt". If no, keep them separate and short.
- **Short transactions.** The clock starts at `BEGIN`. Everything inside holds a connection and locks, so do slow things (API calls, file uploads, image processing) **outside** and keep the transaction to the writes.
- **Database work and outside-world work can't be one unit.** A transaction can't un-send an email or un-charge a card. The usual pattern is what this lesson accidentally teaches: write a **row** describing what happened, in the same transaction, and let a separate worker act on it later. Your `event` table is a tiny version of that. (The pattern is called an *outbox*.)
- **Retries need idempotency.** A client that times out will retry. If "recommend" isn't protected by a unique key, the retry counts twice. A transaction doesn't help with that; a unique constraint or an idempotency key does.
- **Know what your database does by default.** Postgres's default isolation lets the lost update in section 3.5 happen. Stricter levels exist and cost throughput. Knowing the default is knowing what you must handle yourself.
- **Write the plumbing once.** The `withTransaction` wrapper in section 5 (or `dataSource.transaction`) is how a team stops relearning the `release()` lesson one outage at a time.

## 9. 🔗 Connects to
- [04 — Shared state & the event loop](04-requests-shared-state-event-loop.md): the same lost-update race, one layer up
- [09 — Database, Docker & TypeORM](09-database-docker-typeorm.md) §3.4: `save()` already runs `START TRANSACTION … COMMIT` on its own; §3.6: the connection pool you're borrowing from
- [05 — Exception Filters](05-exception-filters.md): rethrow after rollback so the client gets a proper error
- [10 — Relations](10-relations.md) §4.3: the cascade save is one transaction with three `INSERT`s inside it
- [12 — Indexes & Migrations](12-indexes-migrations.md) (videos 31–32): `queryRunner` shows up again inside migration files

## 10. ✍️ In my own words
> _(write here)_

## 11. 🛠️ Practice

1. **Build it** (the video's feature): an `Event` entity (`id`, `type`, `name`, `payload`), a `recommendations`
   column on `Coffee` with default 0, and `recommendCoffee(coffee)` wrapped in a transaction.
2. **Prove the rollback.** Throw an error on purpose between the two saves. Then check the database: is the
   counter still at its old value, and is the event missing? That's the whole feature working.
3. **Watch it happen.** With `logging: true`, call the endpoint and find `START TRANSACTION`, the two
   statements, and `COMMIT` in the logs. Then compare with the failing version and find `ROLLBACK`.
4. **Reproduce the lost update.** Fire 20 recommends at once:
   ```bash
   for i in $(seq 1 20); do curl -s -X POST localhost:3000/coffee/1/recommend & done; wait
   ```
   Is the counter 20? Then switch to letting the database add (`recommendations + 1`) and try again.
5. **Break the pool on purpose.** Comment out `release()`, fire 15 requests, and watch the app stop responding.
   Put it back. (Then you'll never forget it.)

<details><summary>Hints</summary>

- 1: `nest g class events/entities/event.entity --no-spec`, add `Event` to `forFeature([...])` in `CoffeeModule`,
  and give the payload column `type: 'json'`. The constructor param is `private readonly dataSource: DataSource`, imported from `typeorm`, no decorator.
- 2: `throw new Error('boom')` right after the first save, inside the `try`.
- 3: the log lines will look exactly like section 3.4. If you see `START TRANSACTION` twice, one of the saves is going through a repository instead of `queryRunner.manager`.
- 4: the fix is a single `UPDATE ... SET recommendations = recommendations + 1`, or
  `queryRunner.manager.increment(Coffee, { id }, 'recommendations', 1)`.
- 5: the pool holds 10 connections by default (note 09 §3.6), so request 11 is the one that hangs. Nothing is logged, which is the point.

</details>

## 12. ❓ Quiz

**Q1.** Inside a transaction you call `this.coffeeRepositery.save(coffee)` instead of `queryRunner.manager.save(coffee)`. The event save then fails and you roll back. What's in the database?

- A) Nothing: the rollback undoes both
- B) The coffee change is still there. It ran on a different connection from the pool, so it was never part of the transaction
- C) An error at startup
- D) Both writes are kept

<details><summary>Answer</summary>

**B.** A transaction is a property of **one connection** (section 3.3). This is the most common transaction bug, and nothing warns you: it looks like it works, until a rollback silently keeps half the data.

</details>

**Q2.** You forget `await queryRunner.release()`. The endpoint works fine in testing. What happens in production?

- A) Nothing, the garbage collector cleans it up
- B) Each call leaks one connection. Once the pool is empty every request hangs waiting for a free connection, and the logs show no error
- C) The database rejects new transactions
- D) Only that endpoint is affected

<details><summary>Answer</summary>

**B.** And it hits **every** endpoint, because they share the pool. `finally` exists for exactly this.

</details>

**Q3.** Two users recommend the same coffee at the same moment. The code does `coffee.recommendations++` then saves, inside a transaction. Final count?

- A) 7 (5 + 2), transactions handle it
- B) Possibly 6: both read 5 in JavaScript, both write 6. Atomic doesn't mean alone
- C) One request errors
- D) 5

<details><summary>Answer</summary>

**B.** A transaction promises all-or-nothing, not "no one else touches this row". Let the database do the arithmetic (`recommendations + 1`), or lock the row (section 3.5).

</details>

**Q4.** Inside a transaction you charge a card through Stripe, then write two rows and commit. Stripe is slow today (8 seconds). What's the senior concern?

- A) None, it's all one unit
- B) A connection and its locks are held for 8 seconds per request; a few of those and the pool is empty and the app stalls. Also, a rollback can't un-charge the card
- C) Stripe would reject it
- D) Transactions can't contain HTTP calls

<details><summary>Answer</summary>

**B.** Keep outside-world work outside. Charge first, then open a short transaction to record the result, and make the operation retry-safe.

</details>

**Q5.** Single statement: `UPDATE coffee SET recommendations = recommendations + 1 WHERE id = 1`. No `BEGIN`. Is it safe?

- A) No, it needs a transaction
- B) Yes: one statement is already all-or-nothing, and the increment happens inside the database, so concurrent calls can't lose each other's votes
- C) Only under a stricter isolation level
- D) Only with a lock

<details><summary>Answer</summary>

**B.** Transactions are for grouping **several** statements. This is also why "let the database do the arithmetic" fixes Q3.

</details>
