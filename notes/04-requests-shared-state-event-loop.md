# 04 — Requests, Shared State & the Event Loop

> 📍 **Where on the Big Map:** the line between "SERVER START (once)" and "every request (thousands of times)".
> 🎥 **Video:** not covered. This is backend fundamentals.

## 1. The problem (why this matters)

Nest creates your controller and service **once**. Thousands of requests then use those **same objects**. That raises two questions:
- How do people not get each other's data?
- What happens when 1,000 requests arrive at the same moment?

If you don't understand this, you'll eventually write a bug where **user A sees user B's data**, or one slow line freezes the whole server.

## 2. Mental model: the bank

```
 One teller (the service object)          → serves every customer all day
 The teller's desk drawer (fields: this.x)→ stays between customers; everyone's requests touch it
 The customer's card (request data)       → id, token, body: different for each customer
 The teller's scratch paper (local vars)  → used for ONE customer, thrown away after
 The bank's records (database)            → where people's real data lives, looked up BY the card
```

Sharing a teller is fine. **Writing customer A's details in the shared drawer is the bug.**

## 3. How it works behind the scenes

### 3.1 Two lifetimes

```ts
@Injectable()
export class UserService {
  private users = [...];          // FIELD: born at server start, dies at server stop, SHARED

  getUserById(id: string) {       // PARAMETER: born when this call starts
    const user = this.users.find(...);  // LOCAL: born in this call, dies at return
    return user;
  }
}
```

| | Born | Dies | Shared across requests? |
|---|---|---|---|
| Field `this.x` on a singleton | server start (`new`) | server stop / restart | ✅ yes |
| Parameter / local variable | method call | method returns | ❌ no, one per call |
| `req` / `res` (Express makes them) | request arrives | response sent | ❌ no |

Quick test for any line: **does it say `this.`?** Then it's shared.

(Precise version: fields belong to **the object**. They're shared because Nest hands everyone **the same object**. Two `new UserService()` = two arrays.)

We proved it: `private requestCount = 0` in `UserController` counted 1, 2, 3, 4 across requests and browsers, and only reset on restart.

### 3.2 One thread, one event loop

A Node process runs your JavaScript on **one thread**:

```
 network (C++/OS, handles 1000s of open connections)
       │  requests line up
       ▼
 ┌────────────── event loop (ONE JS thread) ──────────────┐
 │ take next task → run JS until it finishes OR hits await │
 │ → take next task → ...                                  │
 └─────────────────────────────────────────────────────────┘
       ▲
 when awaited I/O (DB, HTTP, file) finishes, the continuation goes back in the line
```

- **I/O waiting doesn't block.** While request A `await`s the database, the thread runs request B. That's how one Node process handles thousands of concurrent requests.
- **CPU work does block.** A 200ms synchronous loop means **nobody else** runs for 200ms.

### 3.3 1,000 users at once: `GET /user?name=saim`

```
req1 → getUser('saim') on THE controller → THE service → JSON → done   (microseconds)
req2 → same objects, own `name`/`user` locals → JSON → done
...
req1000
```

All correct, all fast, **as long as**: no per-request data in fields, and no heavy synchronous work.

### 3.4 How people's data stays separate

1. **Each request carries its own input:** URL, body, and a token/cookie saying who you are.
2. **Each call has its own locals.** Saim's call has `id = "1"`, Ali's has `id = "2"`, at the same time, in the same function.
3. **Each response goes back on the connection it came from.**
4. **Private data is filtered by identity**, not by having separate objects:

```ts
@Get('me/orders')
@UseGuards(AuthGuard)                         // reads token → sets req.user (Day 5 / Day 9)
getMyOrders(@Req() req) {
  return this.orderService.findFor(req.user.id);   // identity passed as a PARAMETER
}
// service: db.orders.findMany({ where: { userId } })
```

### 3.5 Same user, many requests

HTTP is **stateless**: the server doesn't remember you between requests. Two tabs, same person → two independent requests.
Without a token, the server can't even tell they're the same person. `POST /user` five times = five users.

## 4. In our project

- `private users = [...]` in [src/user/user.service.ts](../src/user/user.service.ts): shared in-memory data (resets on restart)
- `private requestCount = 0` in [src/user/user.controller.ts](../src/user/user.controller.ts): the experiment

## 5. ❌ How NOT to do it

**The data leak:**
```ts
@Injectable()
export class OrderService {
  private currentUserId: number;               // ❌ per-request data on a SHARED object

  async getMyOrders(userId: number) {
    this.currentUserId = userId;
    await this.audit.log('viewed orders');     // ← other requests run during this await
    return this.db.orders.findMany({ where: { userId: this.currentUserId } });
  }
}
```
```
t0  Saim: this.currentUserId = 7 → await...
t1  Ali:  this.currentUserId = 9 → await...
t2  Saim resumes → reads this.currentUserId → 9 → Saim receives ALI's orders 💥
```
✅ Use the parameter (`userId`) directly. **Never store "who is asking" on `this`.**

| Also don't | Why |
|---|---|
| Keep app data in memory (like our `users` array) in production | Lost on restart; different on each server copy (see Q2) |
| Heavy sync CPU work in a handler (`bcrypt.hashSync`, huge JSON loops, image resizing) | Blocks every user on that process |
| Read → `await` → write on shared state (`const c = this.count; await x; this.count = c + 1`) | Lost updates under concurrency |

## 6. 🧠 Senior engineer lens

- **Stateless services scale horizontally.** If a server holds nothing important in memory, you can run 10 copies behind a load balancer and any copy can serve any request. State goes in the DB / Redis.
- **"Works on my machine with one user" proves nothing about concurrency.** Race conditions only show up under load, which is why they're so often found in production.
- **The same race exists in databases.** "Read balance → compute → write balance" loses money under concurrency. Fixes: atomic updates (`SET balance = balance - 10`), transactions, locks, idempotency keys (Day 14).
- **CPU-heavy work** → async versions (run on libuv's thread pool), worker threads, or a background queue (Day 15).

## 7. 🔗 Connects to
- [03 — DI](03-modules-controllers-providers-di.md): why there's one instance
- Guards (Day 5) & Better-Auth (Day 9): how identity gets into the request
- Transactions / idempotency (Day 14), queues (Day 15), system design (Day 18)

## 8. ✍️ In my own words
> _(write here)_

## 9. 🛠️ Practice

1. In `UserService.createUser`, simulate a slow DB: `await new Promise((r) => setTimeout(r, 50));` **between** computing `id` and `push` (make the method `async`).
2. Fire 20 concurrent creates:
   ```bash
   for i in $(seq 1 20); do curl -s -X POST localhost:3000/user -H 'Content-Type: application/json' -d "{\"name\":\"u$i\"}" & done; wait
   ```
3. `GET` a few ids. What do you see? Explain it **with a timeline** like the one in section 5.
4. Fix it without removing the `await`.
5. Bonus: add `bcrypt`-like blocking work (`const end = Date.now() + 2000; while (Date.now() < end) {}`) to one route, hit it, and immediately hit a *different* route from another terminal. Time the second request.

<details><summary>Hints</summary>

- Step 3: duplicate ids. Every request read `this.users.length` before any of them pushed.
- Step 4: compute the id **at the moment you push**, with no `await` in between. Or use a counter field incremented synchronously (`this.nextId++`). Why is `this.nextId++` safe here but read-await-write isn't?
- Remove the experiments afterwards (or keep them in a branch).

</details>

## 10. ❓ Quiz

**Q1.** The `OrderService` in section 5 passes all tests and works fine for weeks in staging with 2 testers. What's the most accurate statement?

- A) It's correct, since tests pass
- B) It leaks data only when two requests overlap during the `await`, which is rare in staging and common in production
- C) It crashes on startup under load
- D) Nest creates a new `OrderService` per request, so it's safe

<details><summary>Answer</summary>

**B.** Concurrency bugs depend on **timing**. Low traffic hides them. That's why the rule "no per-request data on `this`" is a design rule, not something you test your way out of.

</details>

**Q2.** You deploy the current app (in-memory `users`) as **3 copies** behind a load balancer. A user does `POST /user` (gets id 4), then `GET /user/4`.

- A) Always works
- B) Sometimes 404, because the GET may land on a copy whose `users` array never received the POST
- C) The load balancer syncs memory between copies
- D) Works if it's the same browser

<details><summary>Answer</summary>

**B.** Each process has **its own memory**. Fix: a shared source of truth (a database).
"Sticky sessions" (pin a user to one copy) is a band-aid: data is still lost on restart, and other users still can't see it.

</details>

**Q3.** One Node process. A route does ~200ms of **synchronous** CPU work. 20 requests arrive at once. Roughly how long does the 20th wait before getting a response?

- A) ~200ms, since Node is async
- B) ~4 seconds
- C) ~20ms
- D) Instantly, since each request gets its own thread

<details><summary>Answer</summary>

**B.** 20 × 200ms back to back on one thread. `async`/`await` doesn't help: the work isn't waiting on I/O, it's using the CPU.
Fixes: async/native implementations (thread pool), worker threads, background queue, more processes.

</details>

**Q4.**
```ts
private count = 0;
async hit() {
  const current = this.count;
  await this.db.ping();        // ~5ms
  this.count = current + 1;
}
```
100 concurrent calls. Final `count`?

- A) Exactly 100
- B) Possibly far less than 100
- C) More than 100
- D) Throws

<details><summary>Answer</summary>

**B. Lost updates.** Many calls read `current = 0` before any writes back, so they all write `1`.
Without the `await` (`this.count++`) it's safe in Node: synchronous code can't be interrupted.
The same bug exists in SQL "read then write". Use atomic updates.

</details>

**Q5.** A user double-clicks "Pay" (two requests within 100ms). Your handler: check order not paid → charge card → mark paid. What happens by default?

- A) Nest detects the duplicate from the same user and ignores one
- B) Both may pass the "not paid" check before either marks it paid, so the card is charged twice
- C) The browser blocks the second request
- D) HTTP keep-alive merges them

<details><summary>Answer</summary>

**B.** Stateless HTTP + check-then-act race. Real fixes: **idempotency key** (client sends a unique key; server refuses repeats),
a DB unique constraint, or an atomic conditional update (`UPDATE orders SET status='paid' WHERE id=? AND status='pending'`, then check rows affected).
Disabling the button on the frontend helps UX but is **not** a guarantee: requests can be retried by networks, proxies, or scripts.

</details>
