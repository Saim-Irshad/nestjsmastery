# 11 — Transactions: all of it, or none of it

> 📍 **Where on the Big Map:** the database layer, below the service.
> 📘 **Official course:** video30 Use Transactions (videos 31 indexes and 32 migrations get their own note)
> 🌿 Branch: `transactions`

## 1. The problem

New feature: a user recommends a coffee. Two writes have to happen:

```
1. that coffee's `recommendations` count goes up by 1
2. a row goes into an `event` table, so analytics can see what happened
```

Write them one after the other and there's a gap in the middle:

```
UPDATE coffee ...  ✅
                   ← server crashes / database restarts / network drops / a bug throws
INSERT event ...   ❌ never runs
```

The counter says 6, the event log says 5, and **nothing in the data tells you which one is right**.
Nobody notices for months. Then a report doesn't add up and there's no way to reconstruct the truth.

Same shape, with money:

```
UPDATE accounts SET balance = balance - 100 WHERE id = 1;   ✅ taken from A
                                                            ← crash
UPDATE accounts SET balance = balance + 100 WHERE id = 2;   ❌ never given to B
```

£100 has vanished. This is the classic example because the damage is obvious, but a broken counter is the
same bug with a quieter outcome.

## 2. What a transaction is

You tell the database: **"these statements are one unit. Apply them all, or none of them."**

```sql
BEGIN;                                                       -- from here, nothing is final
UPDATE coffee SET recommendations = recommendations + 1 ...;
INSERT INTO event (name, type, payload) VALUES (...);
COMMIT;                                                      -- now both are real, together
-- ROLLBACK instead → the database forgets everything since BEGIN
```

- Crash before `COMMIT`? The database throws the half-finished work away **by itself**, on restart. You don't clean up.
- Another request looking at the same rows **never sees the in-between state**. It sees "before" until you commit, then "after".

The four promises, in plain words (their usual names in brackets, you'll meet them in interviews):

| Promise | Meaning |
|---|---|
| all-or-nothing (*atomicity*) | every statement lands, or none does |
| the rules still hold (*consistency*) | constraints and foreign keys are still enforced |
| nobody sees half a job (*isolation*) | other requests see the before or the after, not the middle |
| committed means kept (*durability*) | once `COMMIT` returns, a power cut can't undo it |

## 3. How to write it here

```ts
const queryRunner = this.dataSource.createQueryRunner();

await queryRunner.connect();              // take ONE connection out of the pool and hold it
await queryRunner.startTransaction();     // BEGIN
try {
  await queryRunner.manager.save(coffee);     // both writes go through THIS connection
  await queryRunner.manager.save(event);
  await queryRunner.commitTransaction();      // COMMIT
} catch (err) {
  await queryRunner.rollbackTransaction();    // ROLLBACK, undo everything
  throw err;                                  // let the error layer turn it into a response (note 05)
} finally {
  await queryRunner.release();                // give the connection back, success or failure
}
```

**Why a "query runner" instead of the repositories you already have?**

A transaction lives on **one connection**. Your repositories borrow whatever connection is free from the pool
(note 09 §3.6), so two `save()` calls can easily run on two different ones:

```
repo.save(coffee) ──► connection #3   BEGIN was on #7, so this isn't in the transaction
repo.save(event)  ──► connection #5
```

`createQueryRunner()` is you saying "give me one connection and let me keep it until I'm done".
**Everything inside the transaction must go through `queryRunner.manager`.**

**`release()` is not optional.** Forget it and that connection never goes back to the pool. On a busy endpoint
the pool empties after ~10 requests and the whole app hangs waiting for a free connection, with no error
explaining why. That's why it's in `finally`: it runs whether you committed or rolled back.

**Course vs your version:** the video injects `Connection`, the old TypeORM name. Yours is:

```ts
constructor(
  @InjectRepository(Coffee) private readonly coffeeRepositery: Repository<Coffee>,
  private readonly dataSource: DataSource,     // plain constructor param, no decorator
) {}
```

No `@InjectRepository` here because `DataSource` is a class TypeORM registered for us, so its own name is
enough to find it (note 03).

## 4. ⚠️ A transaction is not a lock

This is the part most people get wrong. Two users recommend the same coffee at the same moment:

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

Both transactions are perfectly atomic and both commit. **Atomic doesn't mean alone.** The read happened in
your JavaScript, on a value that was already stale by the time you wrote it (the same lost-update race as note 04).

Ways out, cheapest first:
- **Let the database do the arithmetic**: `UPDATE coffee SET recommendations = recommendations + 1 WHERE id = ?`.
  One statement, nothing read into JS, impossible to lose.
- **Lock the row while you work**: `SELECT ... FOR UPDATE` makes the second transaction wait.
- **Check-and-retry** (*optimistic locking*): a version column; if the row changed under you, redo the work.

Rule of thumb: **if the new value depends on the old one, don't compute it in JavaScript.**

## 5. ❌ How NOT to do it

| Don't | What goes wrong |
|---|---|
| Use `this.repo.save()` inside a transaction | It runs on a different connection, so it isn't in your transaction and won't roll back |
| Forget `release()` | The connection never returns to the pool; the app hangs once the pool is empty |
| Forget `rollbackTransaction()` in the catch | The transaction stays open, holding locks, until it times out. Other requests queue behind it |
| Swallow the error after rolling back | The client gets "success" for something that didn't happen |
| Call an external API inside a transaction | The connection is held for as long as Stripe takes to answer. Do the work, then open a short transaction |
| Wrap a whole request "just in case" | Long transactions hold locks and connections; they're how one slow endpoint takes down everything |
| Assume a transaction stops concurrent updates | It doesn't (section 4). Atomic ≠ alone |
| Reach for a transaction for a single statement | One statement is already all-or-nothing on its own |

## 6. 🧠 Senior engineer lens

- **Ask "must these happen together?"** If yes, one transaction. Money, inventory, "create user + create their
  default workspace", "mark paid + write receipt". If no, keep them separate and short.
- **Short transactions.** The clock starts at `BEGIN`. Everything inside holds a connection and locks, so do
  slow things (API calls, file uploads, image processing) **outside** and keep the transaction to the writes.
- **Database work and outside-world work can't be one unit.** A transaction can't un-send an email or un-charge
  a card. The usual pattern is what this lesson accidentally teaches: write a **row** describing what happened,
  in the same transaction, and let a separate worker act on it later (an "outbox"). Your `event` table is a
  tiny version of that.
- **Retries need idempotency.** A client that times out will retry. If "recommend" isn't protected by a unique
  key, the retry counts twice. A transaction doesn't help with that; a unique constraint or an idempotency key does.
- **Know what your database does by default.** Postgres's default isolation lets the "lost update" in section 4
  happen. Stricter levels exist and cost throughput. Knowing the default is knowing what you must handle yourself.

## 7. 🔗 Connects to
- [04 — Shared state & the event loop](04-requests-shared-state-event-loop.md): the same lost-update race, one layer up
- [09 — Database, Docker & TypeORM](09-database-docker-typeorm.md) §3.6: the connection pool you're borrowing from
- [05 — Exception Filters](05-exception-filters.md): rethrow after rollback so the client gets a proper error
- 12 — Indexes & migrations (videos 31–32)

## 8. ✍️ In my own words
> _(write here)_

## 9. 🛠️ Practice

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
  and give the payload column `type: 'json'`.
- 2: `throw new Error('boom')` right after the first save, inside the `try`.
- 4: the fix is a single `UPDATE ... SET recommendations = recommendations + 1`, or
  `queryRunner.manager.increment(Coffee, { id }, 'recommendations', 1)`.

</details>

## 10. ❓ Quiz

**Q1.** Inside a transaction you call `this.coffeeRepositery.save(coffee)` instead of `queryRunner.manager.save(coffee)`. The event save then fails and you roll back. What's in the database?

- A) Nothing: the rollback undoes both
- B) The coffee change is still there. It ran on a different connection from the pool, so it was never part of the transaction
- C) An error at startup
- D) Both writes are kept

<details><summary>Answer</summary>

**B.** A transaction is a property of **one connection**. This is the most common transaction bug, and nothing warns you: it looks like it works, until a rollback silently keeps half the data.

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

**B.** A transaction promises all-or-nothing, not "no one else touches this row". Let the database do the arithmetic (`recommendations + 1`), or lock the row.

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
