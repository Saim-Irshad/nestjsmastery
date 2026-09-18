# 06 — Interceptors

> 📍 **Where on the Big Map:** they wrap the handler. The **before** part runs after guards and before pipes; the **after** part runs once the handler returns, before the response is sent.
> 🎥 **Video:** 00:33:21 – 00:38:04 (theory) · 01:27:53 (used in the build)

## 1. The problem (why this exists)

You want every successful response to look the same for the frontend:

```json
{ "success": true, "statusCode": 200, "data": { "id": 1, "name": "saim" } }
```

Without interceptors, you'd write this in **every** controller method:

```ts
@Get('/:id')
getUserbyId(@Param('id') id: string) {
  const user = this.userService.getUserById(id);
  return { success: true, statusCode: 200, data: user };   // copy-pasted 80 times
}
```

Same story for "log how long every request took", "time out requests after 5s", "cache this response", "remove `password` from every user object".
These are **cross-cutting concerns**: jobs that apply to many routes but have nothing to do with any single route's business logic.

Interceptors let you write that logic **once** and wrap it around handlers.

## 2. Mental model

Frontend link: **axios interceptors.** Same idea, but on the server side.

```js
// frontend: runs around EVERY request your app makes
axios.interceptors.request.use((config) => { config.headers.Authorization = token; return config; });
axios.interceptors.response.use((res) => res.data);   // unwrap every response
```

Nest interceptors run around **every request your server handles**: code before the handler, code after it.

Picture an **onion**. The handler is the center and each interceptor is a layer:

```
request ─►  Interceptor A (before)
              Interceptor B (before)
                 pipes → HANDLER → service
              Interceptor B (after)      ← inner layer finishes first
            Interceptor A (after)  ─► response
```

## 3. How it works behind the scenes

### 3.1 The shape of an interceptor

```ts
intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
  // ── BEFORE: runs before the handler ──
  const start = Date.now();

  return next.handle()          // ← "run the rest": inner interceptors → pipes → handler
    .pipe(
      // ── AFTER: runs when the handler's result arrives ──
      map((data) => ({ success: true, data })),
    );
}
```

- `next.handle()` **is** the handler call. If you never call it, **the handler never runs** (that's how a cache interceptor returns a stored response).
- What `next.handle()` returns isn't the data. It's an **Observable** that will deliver the data.

### 3.2 What Nest does with it (pseudo-code)

```js
// Nest builds the onion from inside out
let call = () => from(runPipesThenHandler());        // the center; a Promise becomes an Observable

for (const interceptor of [...interceptors].reverse()) {
  const inner = call;
  call = () => interceptor.intercept(context, { handle: inner });   // wrap one more layer
}

const result = await lastValueFrom(call());   // subscribe, wait for the final value
res.status(status).json(result);              // send it
```

So each interceptor gets a `next` whose `handle()` runs **everything inside it**.
Your handler can return a plain value, a Promise, or an Observable; Nest turns them all into an Observable first.

### 3.3 RxJS, just enough

| Promise (you know this) | Observable (RxJS) |
|---|---|
| one future value | a stream: 0, 1 or many values over time |
| starts immediately | starts only when someone **subscribes** (Nest does) |
| `promise.then(fn)` | `obs.pipe(map(fn))` |
| can't be cancelled | can be unsubscribed |

Operators you'll actually use in interceptors (`.pipe(...)` chains them like array methods):

| Operator | Does | Like |
|---|---|---|
| `map(fn)` | replace the value with `fn(value)` | `.then(v => fn(v))` |
| `tap(fn)` | run a side effect, value passes through **unchanged** | `.then(v => { log(v); return v; })` |
| `catchError(fn)` | handle an error: return a new Observable or rethrow | `.catch(fn)` |
| `timeout(ms)` | error if no value within `ms` | `Promise.race` with a timer |
| `of(value)` | make an Observable from a plain value | `Promise.resolve(value)` |

Why does Nest use Observables instead of Promises? Operators like `timeout`, `retry` and `catchError` compose cleanly,
and the same interceptor works for streaming transports (WebSockets, microservices), not only HTTP.

### 3.3a Which "pipe"? Four different things share one name

| Where you see it | What it is | Moves |
|---|---|---|
| `obs.pipe(map(...))` in an interceptor | **RxJS `pipe`**: chains operators on an Observable, like `.then().then()` | one value (per request) through functions |
| `readStream.pipe(writeStream)` | **Node stream pipe** | chunks of bytes (files, uploads) |
| `@UsePipes()`, `ParseIntPipe`, `ValidationPipe` | **Nest Pipes** (note 07): the validation/conversion layer before the handler | request params/body |
| `cat file \| grep x` | **shell pipe** | text between programs |

Same idea ("output of one step goes into the next"), but **four unrelated tools**. In our interceptor, `.pipe` is **RxJS only**. No streaming, and nothing to do with Nest Pipes.

### 3.3b Build a tiny Observable yourself (it's just functions)

An Observable is **an object holding a function that will push values to whoever subscribes**. RxJS is fancier, but the core is this (run and verified):

```js
function createObservable(producer) {
  return {
    subscribe(observer) { producer(observer); },                 // run the producer only now
    pipe(...operators) { return operators.reduce((obs, op) => op(obs), this); },
  };
}

// map = take an Observable, return a NEW Observable whose values are transformed
function map(fn) {
  return (source) => createObservable((observer) => {
    source.subscribe({
      next: (value) => observer.next(fn(value)),   // transform values
      error: (err) => observer.error(err),         // errors pass straight through: fn NOT called
      complete: () => observer.complete(),
    });
  });
}

// what next.handle() gives you (roughly)
const handlerResult$ = createObservable((observer) => {
  try { observer.next(userController.getUserbyId('1')); observer.complete(); }
  catch (e) { observer.error(e); }
});

const wrapped$ = handlerResult$.pipe(map((data) => ({ success: true, data })));
// ↑ nothing has run yet: just a recipe

wrapped$.subscribe({                               // what Nest does
  next: (body) => res.json(body),                  // → {"success":true,"data":{...}}
  error: (err) => exceptionFilter(err),            // /user/999 lands here; map never ran
});
```

Output when run:
```
GET /user/1
  pipe built, nothing ran yet
  handler runs now
  send json: {"success":true,"data":{"id":1,"name":"saim"}}
GET /user/999
  pipe built, nothing ran yet
  handler runs now
  exception filter got: User not found
```

Two lessons:
1. **`pipe` is function composition.** `map` wraps one Observable in another. Nothing magical.
2. **Lazy.** Building the pipe runs nothing. The handler runs when **Nest subscribes** to what you returned.
   That's why you must `return` it: an Observable nobody subscribes to never runs.

### 3.3c Our interceptor as a timeline (`GET /user/1`)

```
1. Request passes middleware + guards
2. Nest calls  transformInterceptor.intercept(context, next)
     2a. getResponse()                    → Express res object
     2b. statusCode = res.statusCode      → 200 (read NOW, before the handler)
     2c. next.handle()                    → an Observable "recipe" for running the handler (nothing runs yet)
     2d. .pipe(map(...))                  → a bigger recipe: "run handler, then wrap its value"
     2e. return it to Nest
3. Nest subscribes to the returned Observable
     3a. pipes run, then getUserbyId('1') → { id: 1, name: 'saim' }
     3b. map's function runs              → { statusCode: 200, data: {...}, success: true }
4. Nest res.json(...) sends that
```

Same thing with Promises (not valid Nest code, just the idea):
```ts
async intercept(context, next) {
  const statusCode = context.switchToHttp().getResponse().statusCode;
  const data = await runHandler();                  // ≈ next.handle()
  return { statusCode, data, success: true };       // ≈ map(...)
}
```
`next.handle().pipe(map(fn))` ≈ `runHandler().then(fn)`.

### 3.4 `ExecutionContext`: "where am I?"

Same idea as `ArgumentsHost` in exception filters (note 05), plus two extras:

```ts
context.switchToHttp().getRequest();   // Express req
context.switchToHttp().getResponse();  // Express res
context.getHandler();                  // the method about to run, e.g. getUserbyId
context.getClass();                    // the controller class, e.g. UserController
```

`getHandler()`/`getClass()` let an interceptor read **decorator labels** on the route, e.g. a custom `@SkipTransform()` (see Practice).

### 3.5 TypeScript bits in our file

- `implements NestInterceptor`: a promise to TypeScript that this class has an `intercept(context, next)` method. It only exists at compile time (note 02).
- `TransformInterceptor<T>`: `T` is a **type parameter**, a placeholder like a function parameter but for types. `map((data: T) => ...)` means "data is whatever type the handler returns".

### 3.6 Attaching an interceptor

```ts
@UseInterceptors(TransformInterceptor)            // one method, or a whole controller
app.useGlobalInterceptors(new TransformInterceptor());   // main.ts: global, but YOU call `new` → no DI
{ provide: APP_INTERCEPTOR, useClass: TransformInterceptor }  // in a module's providers: global + DI works
```

Same rule as filters: **whoever calls `new` provides the constructor arguments.** Need `Reflector` or a logger injected? Use `APP_INTERCEPTOR`.

## 4. In our project

[src/utils/transform.interceptor.ts](../src/utils/transform.interceptor.ts), **not attached yet**:

```ts
intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
  const response = context.switchToHttp().getResponse();   // BEFORE: grab Express res
  const statusCode = response.statusCode ?? 200;           // BEFORE: read status NOW (see ⚠️)

  return next.handle().pipe(                               // run handler
    map((data: T) => ({ statusCode, data, success: true })),  // AFTER: wrap result
  );
}
```

**Tested for real (attached globally, 2026-09-17):**

| Request | HTTP status | Body |
|---|---|---|
| `GET /user/1` | 200 | `{"statusCode":200,"data":{"id":1,"name":"saim"},"success":true}` |
| `POST /user` | 201 | `{"statusCode":201,"data":{"id":4,"name":"ali"},"success":true}` |
| `GET /user/999` (throws) | 404 | `{"message":"User with ID \"999\" not found","error":"Not Found","statusCode":404}`: **not wrapped** |

Two things to learn from this:

1. **Errors skip `map`.** When the handler throws, the Observable emits an *error* instead of a value. `map` only runs on values, so the error goes straight to the exception filters (note 05).
   Result: successes have a `success`/`data` envelope and errors don't. The frontend has to handle two shapes.
   Fix: a custom exception filter that returns `{ success: false, statusCode, message }` (note 05 practice). **Interceptor shapes success + filter shapes failure = one contract.**

2. ⚠️ **`statusCode` is read BEFORE the handler runs.** It came out right in the test because Nest had already set the route's default status (200 for GET, 201 for POST).
   But if a handler changes the status itself (e.g. `@Res({ passthrough: true }) res` then `res.status(202)`), the envelope would still say the old number,
   because `statusCode` is a variable captured before the handler ran. Safer: read `response.statusCode` **inside** `map`.

## 5. ❌ How NOT to do it

| Don't | Why it hurts |
|---|---|
| Put business logic in an interceptor ("if user is premium, add discount") | Hidden from anyone reading the service; can't reuse outside HTTP. Business rules go in services. |
| Use an interceptor for auth checks | Guards run **earlier** and exist for "may this request continue?". An interceptor runs after guards, so a rejected user has already passed more layers. |
| Validate input in an interceptor | That's what pipes do, per parameter, with proper 400 errors. |
| Forget to `return next.handle()...` | The handler never runs, or Nest gets `undefined` instead of an Observable → error. |
| Attach the same wrapping interceptor globally **and** on a controller | Double envelope: `{ data: { success, data: {...} } }` |
| Wrap everything, including file downloads / streams | `StreamableFile` gets turned into JSON → broken downloads. Skip those routes. |
| `catchError` that returns a success value | Swallows real errors. Clients get `success: true` for a failure (the note 05 anti-pattern again). |
| Log full request/response bodies | Passwords, tokens and personal data end up in logs. |
| Use `@Res()` without `passthrough` in a handler | You've already sent the response yourself, so the interceptor's `map` result goes nowhere. |

## 6. 🧠 Senior engineer lens

- **Envelopes are a team decision, not a rule.** The HTTP status already says success/failure, so `success: true` is redundant, and many large APIs don't wrap.
  Envelopes help when you need a predictable shape and room for `meta` (pagination, request id). **Pick one style, apply it globally, document it, and don't change it without versioning.**
- **A timing interceptor lies a little.** It measures from the interceptor to the handler finishing. Middleware, guards and JSON serialization are outside that window.
  Real latency is measured at the edge (load balancer / APM tools).
- **`timeout()` doesn't stop the work.** The client gets an error after 5s, but the DB query **keeps running** (Promises can't be cancelled).
  Under load, timed-out work piles up and makes things worse. Real fixes: DB statement timeouts, `AbortController` for HTTP calls, and making the slow thing faster.
- **Caching interceptors + personal data = leak.** Cache `/user/me/orders` by URL only, and user B gets user A's orders (the note 04 bug again, at the cache layer).
  Cache keys must include identity, or don't cache personal responses in a shared cache.
- **Order matters.** Global interceptors wrap controller ones, which wrap method ones. A logging interceptor outside a caching one logs cache hits; inside, it doesn't.

## 7. 🔗 Connects to
- [03 — DI](03-modules-controllers-providers-di.md): `APP_INTERCEPTOR` vs `new` in `main.ts`
- [04 — Shared state](04-requests-shared-state-event-loop.md): caching leaks, and why timeouts don't cancel work
- [05 — Exception Filters](05-exception-filters.md): errors bypass `map`, so filters shape failures
- 07 — Pipes: run **after** the interceptor's before-part and **before** the handler
- 15 — Guards: run **before** interceptors; they decide access

## 8. ✍️ In my own words
> _(write here)_

## 9. 🛠️ Practice

1. **Attach** `TransformInterceptor` globally with DI (`APP_INTERCEPTOR` in `AppModule`). Check `GET /user/1` and `POST /user`.
2. **Fix** the stale-status problem by reading `statusCode` inside `map`.
3. **`LoggingInterceptor`**: log `GET /user/1 → 200 in 3ms`. Also log failures: `GET /user/999 → ERROR in 1ms`.
4. **`@SkipTransform()`**: a decorator that makes one route return its raw value, unwrapped.
5. **`TimeoutInterceptor`** (3s): add a test route that waits 10s, then logs `"slow work finished"`. Hit it. When does the client get a response? Does the log still appear? Why?
6. Pair with note 05: add the `{ success: false, ... }` exception filter, so both shapes match.

<details><summary>Hints</summary>

- 1: `import { APP_INTERCEPTOR } from '@nestjs/core'` → `providers: [AppService, { provide: APP_INTERCEPTOR, useClass: TransformInterceptor }]`.
- 3: `tap({ next: () => ..., error: () => ... })` sees both paths without changing them. Get method/url from `context.switchToHttp().getRequest()`.
- 4: `export const SkipTransform = () => SetMetadata('skipTransform', true);`. In the interceptor, inject `Reflector` and use
  `this.reflector.getAllAndOverride<boolean>('skipTransform', [context.getHandler(), context.getClass()])`. If true, `return next.handle();` unchanged. (Why does this force you to use `APP_INTERCEPTOR`?)
- 5: `next.handle().pipe(timeout(3000), catchError((err) => err instanceof TimeoutError ? throwError(() => new RequestTimeoutException()) : throwError(() => err)))`.
  Slow route: `await new Promise((r) => setTimeout(r, 10000)); console.log('slow work finished');`.
- Remove test routes afterwards.

</details>

## 10. ❓ Quiz

**Q1.** `TransformInterceptor` is attached globally. `GET /user/999` throws `NotFoundException`. What does the client get?

- A) `{ statusCode: 404, data: {...error}, success: true }`
- B) The normal 404 error body, not wrapped, because `map` only runs on values and errors skip it
- C) `{ statusCode: 200, data: null, success: true }`
- D) The request hangs because the Observable never emits

<details><summary>Answer</summary>

**B.** Verified by running it. A thrown error becomes an Observable **error**, which skips `map` and `tap`'s `next` and reaches the exception filters.
To touch errors inside an interceptor you'd need `catchError`.

</details>

**Q2.** Global interceptors registered as `[LoggingA, LoggingB]`. Each logs "before X" and "after X". Output order for one request?

- A) before A, before B, after A, after B
- B) before A, before B, after B, after A
- C) before B, before A, after A, after B
- D) Random, since they run in parallel

<details><summary>Answer</summary>

**B. Onion.** A is the outer layer: it starts first and finishes last. B is inside A.
Consequence: if B transforms the response with `map`, A's after-part sees the **transformed** value.

</details>

**Q3.** Someone adds a `CacheInterceptor` that caches GET responses for 60s using `request.url` as the key. `GET /user/me/orders` returns the logged-in user's orders. What happens in production?

- A) Works fine; each user has their own cache
- B) The first user's orders get cached under `/user/me/orders` and served to **every** user for 60s
- C) Nest skips caching for authenticated routes automatically
- D) Only slower, no correctness issue

<details><summary>Answer</summary>

**B.** Same URL, different people. The interceptor returns the cached value **without calling `next.handle()`**, so the handler (and its `userId` filter) never runs.
Fix: include the user id in the key, or don't cache personal data in a shared cache. Public data (`/hackathons`) is the safe thing to cache.

</details>

**Q4.** `TimeoutInterceptor` with `timeout(5000)`. A report query takes 30s. 200 users request the report within a minute. What's the real risk?

- A) None: each request is stopped at 5s, so the DB is protected
- B) Clients get 408 at 5s, but all 200 queries **keep running** in the DB, starving other requests
- C) Node kills the queries automatically
- D) The interceptor retries the query

<details><summary>Answer</summary>

**B.** `timeout` stops **waiting**, not the work: Promises can't be cancelled. Users see an error *and* the database is overloaded.
Fixes: DB-level statement timeouts, generate the report in a background job (Day 15) and notify when done, add indexes (Day 8).

</details>

**Q5.** Which job fits an **interceptor** best?

- A) Reject requests without a valid token
- B) Check that `id` is a positive integer
- C) Add `X-Response-Time` and a `requestId` to every response
- D) Enforce "max 3 hackathons per user"

<details><summary>Answer</summary>

**C.** It's cross-cutting, has no business meaning, and needs both before (start time) and after (set header) parts.
A → guard (runs earlier, meant to deny). B → pipe (per-parameter validation, 400). D → service (business rule, must also hold outside HTTP).

</details>

**Q6.** In `main.ts`: `app.useGlobalInterceptors(new TransformInterceptor())`. You add `constructor(private readonly reflector: Reflector) {}` to support `@SkipTransform()`. What happens?

- A) Nest injects `Reflector` automatically because the class is `@Injectable()`
- B) TypeScript error: missing argument. You called `new`, so DI isn't involved. Pass `app.get(Reflector)` manually, or register via `APP_INTERCEPTOR`.
- C) Compiles; `reflector` is `undefined` at runtime
- D) Works only for controller-level interceptors

<details><summary>Answer</summary>

**B.** Same lesson as note 05 Q5: **whoever calls `new` passes the arguments.** `@Injectable()` only matters when Nest does the `new`.

</details>
