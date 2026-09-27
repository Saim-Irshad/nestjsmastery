# 04 — Requests, Shared State & the Event Loop

> 📍 **Where on the Big Map:** the line between "SERVER START (once)" and "every request (thousands of times)". Everything above that line is built one time and then shared; everything below it happens again for each request.
> 🎥 **Video:** not covered. This is backend fundamentals.
> 📘 **Course:** no lesson of its own. Videos 42–43 (provider scope, request-scoped providers) come back to this later · 🌿 **Branch:** `main`

## 1. The problem

Here is an experiment that lives in this repo. In `src/user/user.controller.ts:48` there is a field on the controller, and in the `GET /user` handler that field goes up by one and gets printed:

```ts
@Controller('user')
export class UserController {
  private requestCount = 0;                       // src/user/user.controller.ts:48

  @Get()
  getUser(@Query('name') name: string) {
    this.requestCount++;                          // :80
    console.log('request number', this.requestCount);
    return this.userService.getUserByName(name);
  }
}
```

Hit `GET /user?name=saim` four times, from two different browsers, and the terminal prints:

```
request number 1
request number 2
request number 3
request number 4
```

It never goes back to 1 until the server restarts (or `--watch` reloads after a file save). Two browsers, two people, one number. So the controller object is not made fresh for each request. Nest ran `new UserController(...)` once at startup and every request since has been calling methods on that same object.

That raises a question that should worry you a little. If Saim and Ali both call `GET /user/1` and `GET /user/2` at the same moment, and both calls run on the same controller and the same service, why doesn't Saim get Ali's user back?

Here is the naive way to "remember who is asking", written the way a first attempt often looks. Imagine this app has grown an orders table:

```ts
@Injectable()
export class OrderService {
  private currentUserId: number;                 // "remember who's asking"

  async getMyOrders(userId: number) {
    this.currentUserId = userId;
    await this.audit.log('viewed orders');       // talks to the database, takes a few ms
    return this.db.orders.findMany({ where: { userId: this.currentUserId } });
  }
}
```

It reads fine. It passes every test you would write for it, because tests call it one request at a time. In production, with two people clicking at the same moment, this happens:

```
t0  Saim's request:  this.currentUserId = 7   → await audit.log(...)   (waiting on the DB)
t1  Ali's request:   this.currentUserId = 9   → await audit.log(...)   (waiting on the DB)
t2  Saim's request resumes → reads this.currentUserId → 9 → Saim receives ALI's orders 💥
```

Nobody threw an error. Nothing was logged. Saim is looking at another person's purchase history, and the only way you find out is a support ticket. This note is about why that happens, why the plain `GET /user/1` case is safe, and what rule keeps you on the safe side.

## 2. Mental model

Picture a bank with one teller who serves every customer all day.

```
 One teller (the service object)            → serves every customer all day
 The teller's desk drawer (fields: this.x)  → stays between customers; everyone's requests touch it
 The customer's card (request data)         → id, token, body: different for each customer
 The teller's scratch paper (local vars)    → used for ONE customer, thrown away after
 The bank's records (database)              → where people's real data lives, looked up BY the card
```

Sharing one teller is fine. Customers are served one after the other, each with their own card, and the teller looks up their account in the bank's records. The bug in section 1 is the teller writing customer A's account number in the shared drawer, getting interrupted, and then serving customer B with the number in the drawer.

Frontend version of the same thing: a variable declared at the top of a module, outside the component, is shared by every instance of that component and survives every render. A `const` inside the component body is made fresh for each render. Put per-render data in the module-level variable and two instances start overwriting each other. A field on a Nest service is the module-level variable. A parameter or local inside a method is the per-render `const`.

## 3. Baby steps

### Step 1 — Naive: store per-request data on the shared object

That is the `OrderService` from section 1, and the timeline showed what breaks. Note *when* it breaks: only if a second request arrives while the first one is paused at the `await`. With two testers in staging, that overlap almost never happens. With a thousand users, it happens all day.

### Step 2 — First fix: make a new service object per request

If sharing is the problem, stop sharing:

```ts
@Get('me/orders')
getMyOrders(@Req() req) {
  const service = new OrderService(this.db, this.audit);   // fresh object, fresh currentUserId
  return service.getMyOrders(req.user.id);
}
```

The leak is gone, because each request writes to its own drawer. What is still wrong:

- You are now doing the `new` yourself, so Nest's dependency injection is out of the picture (note 03). Every dependency the service needs, you have to fetch and pass by hand.
- Every request pays to build the object graph again. For one small service that is nothing; for a service that holds a warmed-up cache or a database connection, it is a real cost, and the cache is thrown away every time.
- It treats the symptom. The design still says "the service remembers the current user", and the next person will copy that pattern into a service that *is* shared.

Nest has a built-in version of this idea, where you tell the container to build a fresh instance per request instead of one at startup (course videos 42–43 cover it, and note 04 gets extended then). It exists for real cases, but it carries the same cost, and it is not the everyday answer.

### Step 3 — Better: identity travels as a parameter, and the object holds nothing per-request

```ts
@Injectable()
export class OrderService {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}   // dependencies only

  async getMyOrders(userId: number) {                   // who is asking arrives as an ARGUMENT
    await this.audit.log('viewed orders');
    return this.db.orders.findMany({ where: { userId } });   // read the argument, not a field
  }
}
```

Now Saim's call has `userId = 7` in its own local scope and Ali's call has `userId = 9` in its own. They can interleave at the `await` as much as they like; neither can see the other's argument. The fields on `this` hold only things that are *supposed* to be shared: the database handle, the logger.

Two lifetimes are in play, and it helps to name them explicitly:

```ts
@Injectable()
export class UserService {
  private users = [...];              // FIELD: born at server start, dies at server stop, SHARED

  getUserById(id: number) {           // PARAMETER: born when this call starts
    const user = this.users.find(...);   // LOCAL: born in this call, dies at return
    return user;
  }
}
```

| | Born | Dies | Shared across requests? |
|---|---|---|---|
| Field `this.x` on a shared object | server start (`new`) | server stop / restart | ✅ yes |
| Parameter / local variable | method call | method returns | ❌ no, one per call |
| `req` / `res` (Express makes them) | request arrives | response sent | ❌ no |

Quick test for any line of code: **does it say `this.`?** Then it is shared between every request that ever hits this server.

(The precise version: fields belong to **the object**, not to the class. They feel shared because Nest hands everyone the same object. Call `new UserService()` twice and you get two separate `users` arrays.)

What is still wrong after step 3? Two things, and both come from the fact that shared fields are still there:

1. **Shared counters and caches can still lose updates.** `const c = this.count; await something; this.count = c + 1` has the same interleaving problem as the leak: two requests read `0`, both write `1`. Section 8 and quiz Q4 go into this.
2. **Application data in memory is not durable and not shared across machines.** Our `users` array disappears on restart, and if you ran two copies of the app, each would have its own array (quiz Q2).

### Step 4 — What a senior does

The shared object holds **dependencies and configuration**, never **who is asking** and never **the application's data**. Identity comes in on the request, flows down as arguments, and the database does the filtering:

```ts
@Get('me/orders')
@UseGuards(AuthGuard)                              // reads the token → sets req.user (note 15)
getMyOrders(@Req() req) {
  return this.orderService.findFor(req.user.id);   // identity passed as a PARAMETER
}
// service: this.db.orders.findMany({ where: { userId } })
```

And for anything that is "read a shared value, then write it back", the write is made atomic: `this.count++` with no `await` in between, or `UPDATE ... SET balance = balance - 10` in SQL, so nothing can slip in between the read and the write.

A service written this way holds no per-request memory and no application data, so any copy of it, on any machine, can serve any request. That property is what lets a backend scale by running more copies (that's what people mean by a **stateless service**), and the overlapping-at-`await` bug in step 1 is the classic example of a **race condition**. The "one object built at startup, shared by all" arrangement is Nest's default for every provider, its **singleton scope**.

## 4. How it works underneath

### 4.1 The plain JS Nest and Node are roughly doing

```js
// SERVER START, once  (src/main.ts:38 → NestFactory.create)
const logger = new UserLoggerService();
const userService = new UserService(logger);          // `users` array created here, once
const userController = new UserController(userService);   // `requestCount = 0` set here, once

// per route, once: Nest hands Express a closure
app.get('/user/:id', async (req, res) => {           // req, res: NEW objects for THIS request
  const id = Number(req.params.id);                   // local to this call (ParseIntPipe, note 07)
  const result = await userController.getUserbyId(id);   // SAME controller object every time
  res.json(result);                                   // goes back on the connection it came from
});

// the event loop, roughly
while (true) {
  const task = queue.shift();    // a request arriving, a DB answer coming back, a timer firing
  if (task) task();              // runs until it finishes OR hits an `await`, then the loop continues
}
```

The two halves of the file are the two lifetimes. Everything before `app.get` runs once and produces objects that live for the whole process. Everything inside the closure runs once *per request*, with its own `req`, `res`, `id` and `result`.

### 4.2 One thread, one loop

A Node process runs your JavaScript on **one thread**. There is no second thread waiting to pick up Ali's request while Saim's is running.

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

Two consequences, and they pull in opposite directions:

- **Waiting on I/O does not block.** While request A is paused at `await db.query(...)`, the thread is free and runs request B. That is how one Node process handles thousands of concurrent requests with one thread.
- **CPU work does block.** A 200ms synchronous loop (a big JSON transform, `bcrypt.hashSync`, resizing an image in JS) means **nobody else** runs for 200ms. Every other request waits in line.

### 4.3 The timeline of the leak, on the thread

This is the section 1 bug drawn against the loop. Each `await` is a point where the thread puts the current request down and picks up whatever is next in the queue:

```
 time ──────────────────────────────────────────────────────────────────────────►

 JS thread   │ Saim: getMyOrders(7)      │ Ali: getMyOrders(9)       │ Saim resumes             │ Ali resumes
             │ this.currentUserId = 7    │ this.currentUserId = 9    │ reads this.currentUserId │ reads it
             │ await audit.log → PAUSE   │ await audit.log → PAUSE   │ → 9  ✗ wrong person      │ → 9  ✓ (by luck)
             ├───────────────────────────┼───────────────────────────┼──────────────────────────┼─────────────
 waiting     │ Saim's audit.log ·········│···························│ done ─► back in the queue │
 (libuv/DB)  │                           │ Ali's audit.log ··········│···························│ done ─► back
```

Replace `this.currentUserId` with the argument `userId` and the "reads" column reads a local that nobody else can touch. Same interleaving, no bug.

### 4.4 1,000 users at once, the safe case

`GET /user?name=saim` a thousand times at the same second:

```
req1    → getUser('saim') on THE controller → THE service → JSON → done   (microseconds)
req2    → same objects, own `name` / `user` locals → JSON → done
...
req1000
```

All correct, all fast, **as long as** two things hold: no per-request data on fields, and no heavy synchronous work in the handler.

### 4.5 How people's data stays separate, in four lines

1. **Each request carries its own input:** URL, body, and a token or cookie saying who you are.
2. **Each call has its own locals.** Saim's call has `id = 1`, Ali's has `id = 2`, at the same time, in the same function.
3. **Each response goes back on the connection it came from.** Express keeps `req` and `res` together.
4. **Private data is filtered by identity**, not by having separate objects. The database is asked "orders where userId = 7", and 7 came from Saim's token.

### 4.6 The same user, many requests

The server does not remember you between requests. Open two tabs and refresh both: that is two independent requests, and without a token the server cannot even tell they came from the same person. `POST /user` five times creates five users, because nothing on the server says "this is the same person who posted a second ago". That forgetfulness is a design choice in HTTP, and it is the reason identity has to be carried on every request (that is what "HTTP is **stateless**" means).

## 5. Functional vs class

The same service in the style you already write, and in the class style Nest uses. Read the two columns line by line; the sharing rules are identical.

```js
// FUNCTIONAL (closure factory)                  // CLASS (what the repo uses)
function createUserService(logger) {             @Injectable()
  const users = [{ id: 1, name: 'saim' }];       export class UserService {
  //  ↑ closure var: created ONCE when the         private users = [{ id: 1, name: 'saim' }];
  //    factory runs; every method shares it       //  ↑ field: created ONCE by `new`; every method shares it
  let currentId;   // ← same bug if you store       private currentId: number;   // ← same bug
                   //   per-request data here
  return {                                         constructor(private readonly logger: UserLoggerService) {}
    getUserById(id) {          // per call            getUserById(id: number) {          // per call
      const user = users.find((u) => u.id === id);     const user = this.users.find((u) => u.id === id);
      logger.log(`looking up ${id}`);                  this.logger.log(`looking up ${id}`);
      return user;                                     return user;
    },                                               }
  };                                               }
}
const userService = createUserService(logger);   // Nest: new UserService(logger), once, at startup
```

In both versions, `users` is created once and shared by every call, `id` and `user` are per call, and a `currentId` written before an `await` is the section 1 bug. The functional version makes the shared thing a closure variable; the class version makes it a field reached through `this`. `this` is the object before the dot, and the object before the dot is the one Nest built at startup.

What the class version buys:

- **The `this.` test.** Sharing is visible on the line itself. In the closure version, you have to look up to see whether `users` was declared inside `getUserById` or outside it.
- **Nest can build it.** The container reads constructor parameter types to know what to pass (note 03). A factory function has no such labels, so you would wire it by hand.
- **One shape for everything.** Services, controllers, guards, interceptors and filters are all "a class with fields and methods", so the same DI, the same testing tricks, the same reading habits apply everywhere.

What it costs:

- `this` depends on *how* a method is called, not where it was written. `const fn = userController.getUser; fn('saim')` loses `this` (note 02). Closures do not have that trap.
- It is easier to add a field "for a moment" than to add a closure variable, and that is exactly how `private currentUserId` gets written.

Pick the class in Nest, because the framework is built around it. Keep the closure picture in your head, because it tells you instantly what is shared: anything declared outside the function that runs per request.

## 6. In my project

- `src/main.ts:38` — `NestFactory.create(AppModule)`: the one place where the shared objects are built. Everything the comments there describe (`new UserLoggerService()`, `new UserService(logger)`, `new UserController(userService)`) happens once.
- `src/user/user.controller.ts:48` — `private requestCount = 0`, the experiment. `:80–81` increment it and print it. Output across four requests from two browsers: `request number 1` … `request number 4`, and it only reset on restart.
- `src/user/user.service.ts:84–88` — `private users: User[] = [...]`: application data living in memory on the one shared service. Users added with `POST /user` stay while the server runs and vanish on restart or on a `--watch` reload (the comment at `:76–80` says the same).
- `src/user/user.service.ts:136–137` and `:158` — `id: this.users.length + 1` followed by `this.users.push(newUser)`. Today there is no `await` between the two, so it is safe. Put one in and you have the practice task below.

## 7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| Store "who is asking" on `this` (`this.currentUserId = userId`, then `await`) | Two overlapping requests overwrite each other's value; the first one resumes with the second one's id | Saim sees Ali's orders. No error, no log line; found via a support ticket, usually weeks later |
| Keep application data in memory (like our `users` array) in production | Lost on every restart or deploy; with 2+ copies behind a load balancer each copy has different data (quiz Q2) | Users whose `POST` landed on copy A get 404 from copy B; everyone loses data on deploy |
| Heavy synchronous CPU work in a handler (`bcrypt.hashSync`, huge JSON loops, image resizing) | The one JS thread is busy, so every other request on this process waits (quiz Q3) | Everyone, including users on completely unrelated routes, sees the app "hang" |
| Read → `await` → write on shared state (`const c = this.count; await x; this.count = c + 1`) | Several requests read the same old value and all write back the same new one; updates are lost (quiz Q4) | Whoever relies on the number: rate limits that don't limit, counters that undercount, balances that are wrong |
| "Works with one user, so it's fine" | Race conditions depend on timing and only show up when requests overlap, which means under real traffic | The on-call engineer at 3am, looking at a bug that cannot be reproduced locally |

## 8. 🧠 Senior engineer lens

- **Stateless services scale horizontally.** If a server holds nothing important in memory, you can run 10 copies behind a load balancer and any copy can serve any request. Anything that must survive goes in the database or a shared store like Redis. "Sticky sessions" (pinning a user to one copy) is a band-aid: data is still lost on restart, and other users still can't see it.
- **"Works on my machine with one user" proves nothing about concurrency.** Race conditions only show up under load, which is why they are so often found in production and so rarely in tests. The defence is a design rule (no per-request data on shared objects; atomic writes), not a test you can write.
- **The same race exists in databases.** "Read balance → compute → write balance" loses money under concurrency, exactly like `this.count`. Fixes: atomic updates (`SET balance = balance - 10`), transactions and locks (note 11), unique constraints (note 07), and idempotency keys for "do this once even if the client retries" (quiz Q5).
- **CPU-heavy work belongs off the request thread.** Use the async versions of libraries (they run on libuv's thread pool, not your JS thread), worker threads, or a background queue that the request only *enqueues* into (Day 18, system design).
- **Per-request instances are a tool, not a default.** Nest can build a provider per request (course videos 42–43). It solves real problems (per-request context, multi-tenant connections) at a real cost: every dependency up the chain becomes per-request too, and startup work gets repeated on every call.

## 9. 🔗 Connects to

- [03 — DI](03-modules-controllers-providers-di.md): why there is one instance of each provider, and how it gets built
- [02 — Classes & `this`](02-js-classes-objects-this.md): fields belong to the object; `this` is the object before the dot
- [05 — Exception Filters](05-exception-filters.md): an unhandled rejection on this one thread takes the whole process down
- [06 — Interceptors](06-interceptors.md): a cache keyed by URL is this same leak, one layer up; and why a timeout cannot cancel the work
- [07 — Pipes & Validation](07-pipes-validation.md): why "email must be unique" needs a DB constraint, not a check-then-insert
- [11 — Transactions](11-transactions.md): lost updates and race conditions inside the database
- 15 — Guards, and the auth course (Days 16–17): how identity gets onto the request in the first place
- Course videos 42–43 (request-scoped providers) and Day 18 (system design: queues, replicas, load balancers)

## 10. ✍️ In my own words
> _(write here)_

## 11. 🛠️ Practice

1. In `UserService.createUser`, simulate a slow DB: `await new Promise((r) => setTimeout(r, 50));` **between** computing `id` and `push` (make the method `async`).
2. Fire 20 concurrent creates:
   ```bash
   for i in $(seq 1 20); do curl -s -X POST localhost:3000/user -H 'Content-Type: application/json' -d "{\"name\":\"u$i\",\"email\":\"u$i@x.com\"}" & done; wait
   ```
3. `GET` a few ids. What do you see? Explain it **with a timeline** like the one in section 4.3.
4. Fix it without removing the `await`.
5. Bonus: add `bcrypt`-like blocking work (`const end = Date.now() + 2000; while (Date.now() < end) {}`) to one route, hit it, and immediately hit a *different* route from another terminal. Time the second request.

<details><summary>Hints</summary>

- Step 3: duplicate ids. Every request read `this.users.length` before any of them pushed.
- Step 4: compute the id **at the moment you push**, with no `await` in between. Or use a counter field incremented synchronously (`this.nextId++`). Why is `this.nextId++` safe here but read-await-write isn't?
- Remove the experiments afterwards (or keep them in a branch).

</details>

## 12. ❓ Quiz

**Q1.** The `OrderService` in section 1 passes all tests and works fine for weeks in staging with 2 testers. What's the most accurate statement?

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
