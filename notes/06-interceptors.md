# 06 — Interceptors

> 📍 **Where on the Big Map:** they wrap the handler. The **before** part runs after guards and before pipes; the **after** part runs once the handler returns, before the response is sent.
> 🎥 **Video:** 00:33:21 – 00:38:04 (theory) · 01:27:53 (used in the build)
> 📘 **Course:** videos 56 (Add Pointcuts with Interceptors) and 57 (Handling Timeouts with Interceptors), folded in at §3.5 · video 55 (Using Metadata to Build Generic Guards or Interceptors) extends this note later · 🌿 **Branch:** `main`
> 📚 **Docs:** [Interceptors](https://docs.nestjs.com/interceptors) · [Response mapping](https://docs.nestjs.com/interceptors#response-mapping) · [Exception mapping](https://docs.nestjs.com/interceptors#exception-mapping) · [Binding interceptors](https://docs.nestjs.com/interceptors#binding-interceptors) · RxJS: [`timeout`](https://rxjs.dev/api/operators/timeout) · [`catchError`](https://rxjs.dev/api/operators/catchError) · [`map`](https://rxjs.dev/api/operators/map) · [`tap`](https://rxjs.dev/api/operators/tap)

## 1. The problem

The frontend team asks for one thing: every successful response should have the same outer shape, so one `fetch` wrapper can unwrap everything.

```json
{ "success": true, "statusCode": 200, "data": { "id": 1, "name": "saim" } }
```

The first way anyone does this is in the handler:

```ts
@Get('/:id')
getUserbyId(@Param('id') id: string) {
  const user = this.userService.getUserById(id);
  return { success: true, statusCode: 200, data: user };   // copy-pasted 80 times
}
```

It works for this route. Then there is `POST /user`, which should say `201`, and `PUT /user/:id`, and the coffee routes, and every route anyone adds next month. Eighty handlers, each carrying three lines that have nothing to do with users or coffees. Change the shape once (`data` becomes `payload`) and it is eighty edits and a week of frontend breakage while some routes are updated and some are not.

The same story repeats for other jobs: "log how long every request took", "give up on a request after 5 seconds", "cache this response for a minute", "strip `password` from every user object before it leaves". None of these belong to any single route's business logic, and all of them need to run around many routes at once.

What we want: write that logic **once**, and have it wrap every handler without the handler knowing.

## 2. Mental model

You already use this on the frontend, in axios:

```js
// frontend: runs around EVERY request your app makes
axios.interceptors.request.use((config) => { config.headers.Authorization = token; return config; });
axios.interceptors.response.use((res) => res.data);   // unwrap every response
```

A Nest interceptor is the same idea on the server: code that runs before the handler, and code that runs after it, for every request the server handles.

Picture an **onion**. The handler is the centre and each interceptor is a layer around it. A request goes in through every layer, hits the centre, and the response comes back out through the same layers in reverse:

```
request ─►  Interceptor A (before)
              Interceptor B (before)
                 pipes → HANDLER → service
              Interceptor B (after)      ← inner layer finishes first
            Interceptor A (after)  ─► response
```

## 3. Baby steps

### Step 1 — Naive: build the envelope in every handler

That is the section 1 code. What breaks: the route someone forgets; the `statusCode: 200` that is wrong on a `POST` (Nest sends 201 for `POST` by default, so the body and the status line disagree); and the eighty-edit shape change.

### Step 2 — A helper function

Pull the three lines into one function and call it everywhere:

```ts
// src/utils/envelope.ts
export const envelope = (data: unknown, statusCode = 200) => ({ success: true, statusCode, data });

// every handler
@Get('/:id')
getUserbyId(@Param('id') id: string) {
  return envelope(this.userService.getUserById(id));
}

@Post()
createUser(@Body() dto: CreateUserDto) {
  return envelope(this.userService.createUser(dto), 201);   // you have to remember 201 here
}
```

The shape now lives in one place, which is real progress. What is still wrong: every handler still has to *call* it, so the forgotten route is still possible; the status number is typed by hand and can disagree with what Nest actually sends; and the helper only runs on the success path, because a `throw` in the service never reaches the `return` line.

### Step 3 — Wrap the handler from the outside

In plain JS, the thing you actually want is a function that takes a handler and returns a new handler with the extra behaviour around it. You write these all the time:

```js
// plain JS, Express-style: a higher-order function
const withEnvelope = (handler) => async (req, res) => {
  const data = await handler(req, res);                         // run the real thing
  return { success: true, statusCode: res.statusCode, data };  // wrap what came back
};

app.get('/user/:id', withEnvelope(getUserbyId));   // every route registered this way is wrapped
```

Now handlers know nothing about envelopes, and the status is read from the real response object instead of typed by hand. The catch in Nest: **you do not register the routes, Nest does.** So Nest gives you a hook with the same shape, and calls it for you around every handler. Here is the first version that went into this repo:

```ts
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const response = context.switchToHttp().getResponse();   // BEFORE: grab Express res
    const statusCode = response.statusCode ?? 200;           // BEFORE: read status NOW (see ⚠️ below)

    return next.handle().pipe(                               // run the handler
      map((data: T) => ({ statusCode, data, success: true })),  // AFTER: wrap its result
    );
  }
}
```

Read it against `withEnvelope`: `intercept` is the outer function, `next.handle()` is `await handler(req, res)`, and `map(...)` is the `return { ... }` line. `next.handle()` does not give you the data itself; it gives you a recipe that will deliver the data once the handler has run, and `.pipe(map(fn))` says "when it does, pass the value through `fn`". Section 4 shows exactly what that recipe is. The return type says `Observable`; for now read that word as "a value that arrives later".

This version was attached globally and tested on 2026-09-17 (the table is in section 6). Two things were wrong with it:

- ⚠️ **`statusCode` was read before the handler ran.** It came out right in the test because Nest had already set the route's default (200 for `GET`, 201 for `POST`) before the interceptor's before-part. But if a handler changes the status itself (`@Res({ passthrough: true }) res` then `res.status(202)`), the envelope would still say the old number, because `statusCode` was captured into a variable before the handler had a chance to change it.
- **Errors were not wrapped.** `GET /user/999` came back as the plain 404 body. A thrown error never becomes a value, so `map` never runs on it, and the frontend ends up with two shapes.

### Step 4 — What a senior does

Read the status **inside** `map`, at the moment the value exists, which is what the file looks like now (`src/utils/transform.interceptor.ts:24–34`, fixed 2026-09-18):

```ts
return next.handle().pipe(
  map((data: T) => ({
    statusCode: response.statusCode,   // read HERE, after the handler ran
    data,
    success: true,
  })),
);
```

Then the choices that only show up with a team and traffic:

- **Register it once, globally, through the container** (`APP_INTERCEPTOR` in a module) rather than `new` in `main.ts`, so the class can have dependencies injected (a `Reflector` for reading route labels, a logger).
- **Pair it with an exception filter** (note 05) that shapes errors as `{ success: false, statusCode, message }`. Interceptor shapes success, filter shapes failure, one contract.
- **Give routes a way out.** A file download (`StreamableFile`) must not be turned into JSON; a `@SkipTransform()` label on the route, read through `context.getHandler()`, tells the interceptor to return `next.handle()` untouched.
- **Decide the envelope once, document it, and version it.** Section 8 argues about whether to have one at all.

The hook itself, a class with an `intercept(context, next)` method that Nest calls around every handler, is what Nest calls an **interceptor**. The kind of job it is for, something that applies to many routes and belongs to none of them (envelopes, timing, timeouts, caching), is what people mean by a **cross-cutting concern**.

### 3.5 What the official course adds (videos 56 and 57)

The course builds two interceptors. The first one lands on the same requirement this note started from, which is a good chance to compare two answers to one problem. The second one is new, and it is the more interesting of the two, because it comes with a consequence the video does not mention.

#### Video 56 — `WrapResponseInterceptor`: "run something around every handler"

The framing the course uses for this is **aspect-oriented programming**: some behaviour belongs to many places in a program and to none of them in particular, so instead of editing all those places you describe the behaviour once and say *where* it should be attached. The places where it gets attached are the **pointcuts**; in Nest, a pointcut is "every route", "this controller" or "this method", which is what §4.8 calls binding. The five things the video says an interceptor can do are worth keeping, because they are a checklist for "is this an interceptor's job?":

| Capability | What it looks like in code | Example |
|---|---|---|
| run extra logic before or after the handler | code before `next.handle()`, `tap(...)` after | timing, request logging |
| transform the **result** | `map(...)` | the envelope, stripping `password` |
| transform the **exception** | `catchError(...)` | turning a driver error into a 503 |
| extend the handler's behaviour | `timeout(...)`, `retry(...)` | video 57, below |
| **replace** the handler entirely | return something without calling `next.handle()` | a cache hit |

The course's version of the envelope is deliberately smaller than ours, and it is built in two moves. First `tap`, to see where an interceptor sits in the lifecycle:

```ts
@Injectable()
export class WrapResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    console.log('Before...');
    return next.handle().pipe(tap((data) => console.log('After...', data)));
  }
}
```

Then `tap` is swapped for `map`, because `tap` looks and `map` changes:

```ts
return next.handle().pipe(map((data) => ({ data })));
```

Run for real in a scratch app with a `findAll()` that returns one coffee, bound with `app.useGlobalInterceptors(new WrapResponseInterceptor())` (2026-09-27):

```
[t+0.07s] Before...
[t+0.07s] After... [{"id":1,"name":"Shipwreck Roast"}]

GET /coffees
  HTTP 200 OK
  {"data":[{"id":1,"name":"Shipwreck Roast"}]}
```

Two things to read off that. The `data` argument inside `tap`/`map` **is** the handler's return value, so an interceptor is the one place that sees what every route in the application is about to send. And the two log lines arrived in the same millisecond, because this handler does no I/O: the "before" and "after" parts of an interceptor are not separated by time, they are separated by the handler.

**How this relates to our own `TransformInterceptor`.** Same mechanism, different envelope: ours adds `statusCode` and `success` by reading the Express response (§3, step 4), the course's wraps in `data` and nothing else. The important thing is not which envelope is better, it is that **you get to have exactly one.** Bound both at once, they compose, and the result is what §7 warns about, measured (2026-09-27):

```
app.useGlobalInterceptors(new TransformInterceptor(), new WrapResponseInterceptor());

GET /coffees
  HTTP 200 OK
  {"statusCode":200,"data":{"data":[{"id":1,"name":"Shipwreck Roast"}]},"success":true}
```

`data.data`. The frontend's unwrapper now has to know which routes were double-wrapped, and nothing in either file hints that the other one exists. That is the onion from §2 doing exactly what it promises: the outer interceptor's `map` receives whatever the inner one returned, not what the handler returned. If you follow this course video while this repo already has `TransformInterceptor` registered, you will see that body.

#### Video 57 — `TimeoutInterceptor`: cut off the waiting

**The requirement.** One endpoint generates a report. Most of the time it answers in 300ms; when a particular customer's data is large it takes 30 seconds. While it runs, a browser tab sits there spinning, a connection is held open, and if a load balancer in front of you gives up at 30s the user gets a blank gateway error with no explanation. What you want instead: after a fixed budget, give up waiting and answer with something honest, the same way for every route in the app, so no handler has to think about it.

`timeout(ms)` from RxJS is the operator for that: it watches a stream and, if no value has arrived within `ms`, it errors instead of waiting. The naive version is one line:

```ts
return next.handle().pipe(timeout(3000));
```

Measured against a handler that sleeps 5 seconds (2026-09-27):

```
GET /coffees/slow
  HTTP 500 Internal Server Error after 3.02s
  {"statusCode":500,"message":"Internal server error"}
```

It cut the wait off at the right moment, and then told the client the wrong thing. `timeout` throws RxJS's own `TimeoutError`, which is not an `HttpException`, so the built-in filter did what §4.3 of note 05 describes: hid an unknown error behind a generic 500. A 500 tells the client "our fault, maybe retry"; the truth is "we ran out of time", which has its own status code. So the error has to be translated on the way out:

```ts
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      timeout(3000),
      catchError((err) => {
        if (err instanceof TimeoutError) {                      // from 'rxjs'
          return throwError(() => new RequestTimeoutException()); // from '@nestjs/common' → 408
        }
        return throwError(() => err);                            // not mine: pass it on untouched
      }),
    );
  }
}
```

Same request, same handler, after adding those seven lines (2026-09-27):

```
GET /coffees/slow
  HTTP 408 Request Timeout after 3.03s
  {"message":"Request Timeout","statusCode":408}
```

Three details in that `catchError` are the difference between a useful interceptor and a trap:

- **`throwError(() => x)` rather than `throw x`.** Inside an operator you are building a stream, not running code in a call stack, so you return a stream that errors. It takes a *function* returning the error so that the error object is created at the moment it is emitted, which keeps the stack trace pointing at the right place.
- **The `else` branch re-throws.** Without it, `catchError` would swallow every other error in the application (a `NotFoundException`, a database failure) and return `undefined` as a successful value. That is the "`catchError` that returns a success value" row in §7, and it is a one-line mistake.
- **`catchError` after `timeout`, not before.** Operators apply in order, so anything listed before `timeout` never sees the timeout error.

##### ⚠️ The part the video does not say: the work keeps running

This is the consequence already in §8 and quiz Q4, and here it is measured rather than asserted. The scratch handler logs when it starts its 5 seconds of work and when it finishes; the client's 408 arrives at 3 seconds (2026-09-27):

```
[t+0.07s] slow handler STARTED its 5s of work
GET /coffees/slow → HTTP 408 Request Timeout after 3.03s
[t+3.09s] client is done. waiting 4 more seconds to see what the server does...
[t+5.07s] slow handler FINISHED its work (nobody is listening any more)
```

The handler finished two seconds **after** the client had already been told the request timed out. `timeout` unsubscribes from the Observable, and unsubscribing does not reach into a `Promise` and stop it: the `await` in your handler carries on, and so does the database query, the HTTP call to the payment provider and the file write behind it.

```
what you think happens                   what actually happens
──────────────────────                   ─────────────────────
 t=0  query starts                        t=0  query starts
 t=3  timeout → query cancelled           t=3  timeout → CLIENT gets 408
 t=3  DB is free again                    t=3  query is still running
                                          t=5  query finishes, result thrown away
                                               (the DB did all the work anyway)
```

Why it matters more than it looks: under load a timeout makes things **worse**, not better. Two hundred users hitting that report in a minute means two hundred queries still running in Postgres, plus two hundred users who saw an error and pressed retry. The timeout protected the *client's* patience and did nothing for the *server's* resources. What actually helps: a statement timeout in the database so the query itself is killed (`statement_timeout` in Postgres, `maxExecutionTime` in TypeORM), an `AbortController` for outbound HTTP calls, moving the slow work to a background job, or making it fast (note 12, indexes). The interceptor is the polite message, not the fix.

**Binding both.** `app.useGlobalInterceptors(new TransformInterceptor(), new TimeoutInterceptor())` takes a comma-separated list, and order is the onion order from §2: the first one listed is the outermost. That matters here, because a timeout error raised inside must pass back out through everything wrapped around it. Neither of these two needs a dependency, so `main.ts` is enough; the moment one does, use `APP_INTERCEPTOR` (§4.8, and note 16 Part A step 4).

📚 [Interceptors](https://docs.nestjs.com/interceptors) · [Response mapping](https://docs.nestjs.com/interceptors#response-mapping) · [Exception mapping](https://docs.nestjs.com/interceptors#exception-mapping) · [RxJS `timeout`](https://rxjs.dev/api/operators/timeout) · [RxJS `catchError`](https://rxjs.dev/api/operators/catchError)

## 4. How it works underneath

### 4.1 Nest builds the onion, inside out

```js
// Nest builds the onion from inside out
let call = () => from(runPipesThenHandler());        // the centre; a Promise becomes an Observable

for (const interceptor of [...interceptors].reverse()) {
  const inner = call;
  call = () => interceptor.intercept(context, { handle: inner });   // wrap one more layer
}

const result = await lastValueFrom(call());   // subscribe, wait for the final value
res.status(status).json(result);              // send it
```

So each interceptor gets a `next` whose `handle()` runs **everything inside it**: the inner interceptors, the pipes, the handler. Your handler can return a plain value, a Promise, or an Observable; Nest turns them all into an Observable first, so the interceptor always sees the same kind of thing.

Two consequences fall straight out of that loop:

- `next.handle()` **is** the handler call. If you never call it, **the handler never runs**. That is how a cache interceptor returns a stored response without touching the database.
- What `next.handle()` returns is not the data. It is the recipe for producing the data, and nothing runs until Nest subscribes to what you returned.

### 4.2 The flow for `GET /user/1`, with files

```
 GET /user/1
   │
   ▼
 src/main.ts:69            app.useGlobalInterceptors(new TransformInterceptor())   (registered at startup)
   │
   ▼
 src/utils/transform.interceptor.ts:19   intercept(context, next)        ← BEFORE part
   │   :21  response = context.switchToHttp().getResponse()
   │   :24  return next.handle().pipe(map(...))                           ← builds the recipe, returns it
   ▼
 Nest subscribes to the recipe
   │
   ▼
 src/user/user.controller.ts:100   ParseIntPipe runs on '1' → 1, then getUserbyId(1)
   │
   ▼
 src/user/user.service.ts:122      getUserById(1) → { id: 1, name: 'saim' }
   │
   ▼
 src/utils/transform.interceptor.ts:25   map runs                        ← AFTER part
   │   { statusCode: response.statusCode (200), data: {...}, success: true }
   ▼
 Nest → res.json(...)  →  client
```

### 4.3 What `next.handle()` hands you

You know Promises: one future value, starts as soon as it is created, `.then(fn)` to transform it. The thing `next.handle()` returns is a close cousin with two differences that matter for interceptors:

| Promise (you know this) | What `next.handle()` returns |
|---|---|
| one future value | a stream: 0, 1 or many values over time |
| starts immediately | starts only when someone **subscribes** (Nest does) |
| `promise.then(fn)` | `obs.pipe(map(fn))` |
| can't be cancelled | can be unsubscribed |

That lazy, subscribable stream is an **Observable**, from the RxJS library. The operators you chain with `.pipe(...)` are functions that take a stream and return a new one, the way array methods take an array and return a new one. These are the ones you will actually use in interceptors:

| Operator | Does | Like |
|---|---|---|
| `map(fn)` | replace the value with `fn(value)` | `.then(v => fn(v))` |
| `tap(fn)` | run a side effect, value passes through **unchanged** | `.then(v => { log(v); return v; })` |
| `catchError(fn)` | handle an error: return a new Observable or rethrow | `.catch(fn)` |
| `timeout(ms)` | error if no value within `ms` | `Promise.race` with a timer |
| `of(value)` | make an Observable from a plain value | `Promise.resolve(value)` |

Why does Nest use Observables here instead of Promises? Operators like `timeout`, `retry` and `catchError` compose cleanly, and the same interceptor works for streaming transports (WebSockets, microservices), not only HTTP.

### 4.4 Which "pipe"? Four different things share one name

| Where you see it | What it is | Moves |
|---|---|---|
| `obs.pipe(map(...))` in an interceptor | **RxJS `pipe`**: chains operators on an Observable, like `.then().then()` | one value (per request) through functions |
| `readStream.pipe(writeStream)` | **Node stream pipe** | chunks of bytes (files, uploads) |
| `@UsePipes()`, `ParseIntPipe`, `ValidationPipe` | **Nest Pipes** (note 07): the validation/conversion layer before the handler | request params/body |
| `cat file \| grep x` | **shell pipe** | text between programs |

Same idea ("output of one step goes into the next"), but **four unrelated tools**. In our interceptor, `.pipe` is **RxJS only**. No streaming, and nothing to do with Nest Pipes.

### 4.5 Build a tiny Observable yourself (it is only functions)

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
// ↑ nothing has run yet: only a recipe

wrapped$.subscribe({                               // what Nest does
  next: (body) => res.json(body),                  // → {"success":true,"data":{...}}
  error: (err) => exceptionFilter(err),            // /user/999 lands here; map never ran
});
```

Output when run (the script also had `console.log` lines marking each step; they are what you see printed):
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
2. **Lazy.** Building the pipe runs nothing. The handler runs when **Nest subscribes** to what you returned. That is why you must `return` it: an Observable nobody subscribes to never runs.

### 4.6 The first version as a timeline (`GET /user/1`)

This is the step 3 code, the one that read the status early, laid out in the order things happen:

```
1. Request passes middleware + guards
2. Nest calls  transformInterceptor.intercept(context, next)
     2a. getResponse()                    → Express res object
     2b. statusCode = res.statusCode      → 200 (read NOW, before the handler)   ← the ⚠️
     2c. next.handle()                    → an Observable "recipe" for running the handler (nothing runs yet)
     2d. .pipe(map(...))                  → a bigger recipe: "run handler, then wrap its value"
     2e. return it to Nest
3. Nest subscribes to the returned Observable
     3a. pipes run, then getUserbyId(1)  → { id: 1, name: 'saim' }
     3b. map's function runs              → { statusCode: 200, data: {...}, success: true }
                                            (the fixed version reads res.statusCode HERE, at 3b)
4. Nest res.json(...) sends that
```

Same thing with Promises (not valid Nest code, only the idea):
```ts
async intercept(context, next) {
  const data = await runHandler();                                  // ≈ next.handle()
  const statusCode = context.switchToHttp().getResponse().statusCode;   // after the handler
  return { statusCode, data, success: true };                       // ≈ map(...)
}
```
`next.handle().pipe(map(fn))` ≈ `runHandler().then(fn)`.

### 4.7 `ExecutionContext`: "where am I?"

The first argument to `intercept` answers "which request, which route, which class". It is the same idea as `ArgumentsHost` in exception filters (note 05), plus two extras:

```ts
context.switchToHttp().getRequest();   // Express req
context.switchToHttp().getResponse();  // Express res
context.getHandler();                  // the method about to run, e.g. getUserbyId
context.getClass();                    // the controller class, e.g. UserController
```

`getHandler()` / `getClass()` let an interceptor read **decorator labels** on the route, which is how a custom `@SkipTransform()` works (see Practice, and course video 55).

### 4.8 Attaching an interceptor

```ts
@UseInterceptors(TransformInterceptor)                          // one method, or a whole controller
app.useGlobalInterceptors(new TransformInterceptor());          // main.ts: global, but YOU call `new` → no DI
{ provide: APP_INTERCEPTOR, useClass: TransformInterceptor }    // in a module's providers: global + DI works
```

Same rule as filters: **whoever calls `new` provides the constructor arguments.** Need `Reflector` or a logger injected? Use `APP_INTERCEPTOR`.

## 5. Functional vs class

Side by side: the higher-order function from step 3 and the class Nest asks for.

```js
// FUNCTIONAL (higher-order function)           // CLASS (what the repo uses)
const withEnvelope = (handler) =>               @Injectable()
  async (req, res) => {                         export class TransformInterceptor<T> implements NestInterceptor {
    // BEFORE: nothing to do here                 intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const data = await handler(req, res);           const response = context.switchToHttp().getResponse<Response>();
    // AFTER: wrap                                  return next.handle().pipe(
    return {                                          map((data: T) => ({
      statusCode: res.statusCode,                       statusCode: response.statusCode,
      data,                                             data,
      success: true,                                    success: true,
    };                                                })),
  };                                                );
                                                  }
app.get('/user/:id', withEnvelope(getUserbyId));  }
                                                // registered once: main.ts / APP_INTERCEPTOR
```

Line for line: `handler` ↔ `next.handle()`, `await` ↔ `.pipe(map(...))`, `res` ↔ `context.switchToHttp().getResponse()`. Two TypeScript bits in the class column are worth naming once:

- `implements NestInterceptor` is a promise to TypeScript that this class has an `intercept(context, next)` method with the right signature. It only exists at compile time (note 02).
- `TransformInterceptor<T>`: `T` is a **type parameter**, a placeholder like a function parameter but for types. `map((data: T) => ...)` means "data is whatever type the handler returns".

What the class version buys:

- **Nest calls it for you, around every route.** The higher-order function only wraps the routes you remember to wrap. The class is registered once and Nest applies it to routes that do not exist yet.
- **Dependency injection.** Registered through `APP_INTERCEPTOR`, the class can ask for a `Reflector` (to read route labels), a logger, a cache client. A closure would have to capture those by hand at the place you build it.
- **One shape across transports.** `context.switchToHttp()` exists because the same class can wrap HTTP handlers, WebSocket messages and microservice calls. The closure is welded to `(req, res)`.
- **Operators.** Because the class returns an Observable, `timeout`, `catchError`, `tap` and `retry` are one `.pipe` away. The Promise version would hand-write each of them.

What it costs: RxJS vocabulary for something that, for most HTTP interceptors, is a `.then`; the "you must return the Observable" rule (forget it and the handler never runs); and the `new` versus `APP_INTERCEPTOR` trap (quiz Q6).

## 6. In my project

- `src/utils/transform.interceptor.ts:19–35` — the interceptor. `:21` grabs the Express response in the before-part; `:24` returns `next.handle().pipe(map(...))`; `:30` reads `response.statusCode` **inside** `map`, with a comment dated 2026-09-18 explaining that it used to be read above, before the handler.
- `src/main.ts:69` — `app.useGlobalInterceptors(new TransformInterceptor())`. It is attached globally, with `new`, so nothing can be injected into it (the comment at `:67–68` says the same). Moving it to `APP_INTERCEPTOR` is practice task 1.
- `src/utils/transform.interceptor.spec.ts` — the generated "should be defined" test, nothing more yet.

**Tested for real (attached globally, 2026-09-17):**

| Request | HTTP status | Body |
|---|---|---|
| `GET /user/1` | 200 | `{"statusCode":200,"data":{"id":1,"name":"saim"},"success":true}` |
| `POST /user` | 201 | `{"statusCode":201,"data":{"id":4,"name":"ali"},"success":true}` |
| `GET /user/999` (throws) | 404 | `{"message":"User with ID \"999\" not found","error":"Not Found","statusCode":404}`: **not wrapped** |

Two things to learn from this table:

1. **Errors skip `map`.** When the handler throws, the Observable emits an *error* instead of a value. `map` only runs on values, so the error goes straight to the exception filters (note 05). Result: successes have a `success`/`data` envelope and errors don't, and the frontend has to handle two shapes. Fix: a custom exception filter that returns `{ success: false, statusCode, message }` (note 05 practice). **Interceptor shapes success + filter shapes failure = one contract.** Note 07 recorded the same thing for validation errors: a 400 thrown by the pipe is not wrapped either.

2. ⚠️ **In that test, `statusCode` was read BEFORE the handler ran.** It came out right because Nest had already set the route's default status (200 for `GET`, 201 for `POST`). It would have been wrong for any handler that changes its own status, which is why the file now reads `response.statusCode` inside `map` (step 4).

## 7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| Put business logic in an interceptor ("if user is premium, add discount") | The rule is invisible to anyone reading the service, and does not run for a cron job or queue worker calling the same service | The next developer, who changes the service and cannot work out why premium users still see the old price |
| Use an interceptor for auth checks | Guards run **earlier** and exist for "may this request continue?". By the time an interceptor runs, a rejected user has already passed more layers | Security: the request got further than it should have before being turned away |
| Validate input in an interceptor | Pipes do this per parameter with proper 400 errors; an interceptor sees the raw request and has to reinvent it | Frontend, receiving inconsistent error shapes for bad input |
| Forget to `return next.handle()...` | The handler never runs, or Nest gets `undefined` instead of an Observable and errors | Every user of every route the interceptor is attached to |
| Attach the same wrapping interceptor globally **and** on a controller | Double envelope: `{ data: { success, data: {...} } }` | The frontend, unwrapping twice on some routes and once on others |
| Wrap everything, including file downloads / streams | `StreamableFile` gets turned into JSON, so downloads are broken | Anyone downloading a file. Skip those routes |
| `catchError` that returns a success value | Real errors are swallowed; clients get `success: true` for a failure (the note 05 anti-pattern, one layer up) | Users acting on a "success" that never happened; on-call, with no error in the logs |
| Log full request/response bodies | Passwords, tokens and personal data end up in log storage | Every user, the day the logs leak or an auditor reads them |
| Use `@Res()` without `passthrough` in a handler | You have already sent the response yourself, so the interceptor's `map` result goes nowhere | That route's clients, getting the raw shape while every other route is wrapped |

## 8. 🧠 Senior engineer lens

- **Envelopes are a team decision, not a rule.** The HTTP status already says success/failure, so `success: true` is redundant, and many large APIs don't wrap. Envelopes help when you need a predictable shape and room for `meta` (pagination, request id). **Pick one style, apply it globally, document it, and don't change it without versioning.**
- **A timing interceptor lies a little.** It measures from the interceptor to the handler finishing. Middleware, guards and JSON serialization are outside that window. Real latency is measured at the edge (load balancer / APM tools).
- **`timeout()` doesn't stop the work.** The client gets an error after 5s, but the DB query **keeps running** (Promises can't be cancelled). Under load, timed-out work piles up and makes things worse. Real fixes: DB statement timeouts, `AbortController` for HTTP calls, and making the slow thing faster.
- **Caching interceptors + personal data = leak.** Cache `/user/me/orders` by URL only, and user B gets user A's orders (the note 04 bug again, at the cache layer). Cache keys must include identity, or don't cache personal responses in a shared cache.
- **Order matters.** Global interceptors wrap controller ones, which wrap method ones. A logging interceptor outside a caching one logs cache hits; inside, it doesn't.

## 9. 🔗 Connects to

- [03 — DI](03-modules-controllers-providers-di.md): `APP_INTERCEPTOR` vs `new` in `main.ts`
- [04 — Shared state](04-requests-shared-state-event-loop.md): caching leaks, and why timeouts don't cancel work
- [05 — Exception Filters](05-exception-filters.md): errors bypass `map`, so filters shape failures
- [07 — Pipes](07-pipes-validation.md): run **after** the interceptor's before-part and **before** the handler; validation 400s are not wrapped
- 15 — Guards: run **before** interceptors; they decide access
- Course videos 55–57: metadata-driven interceptors, pointcuts, timeouts

## 10. ✍️ In my own words
> _(write here)_

## 11. 🛠️ Practice

1. **Attach** `TransformInterceptor` globally with DI (`APP_INTERCEPTOR` in `AppModule`) instead of `new` in `main.ts`. Check `GET /user/1` and `POST /user`.
2. **Fix** the stale-status problem by reading `statusCode` inside `map`. (The file already has this fix, dated 2026-09-18. Read the diff between the step 3 and step 4 versions and write down, in one sentence, which request would have exposed the bug.)
3. **`LoggingInterceptor`**: log `GET /user/1 → 200 in 3ms`. Also log failures: `GET /user/999 → ERROR in 1ms`.
4. **`@SkipTransform()`**: a decorator that makes one route return its raw value, unwrapped.
5. **`TimeoutInterceptor`** (3s): add a test route that waits 10s, then logs `"slow work finished"`. Hit it. When does the client get a response? Does the log still appear? Why?
6. Pair with note 05: add the `{ success: false, ... }` exception filter, so both shapes match.

<details><summary>Hints</summary>

- 1: `import { APP_INTERCEPTOR } from '@nestjs/core'` → `providers: [AppService, { provide: APP_INTERCEPTOR, useClass: TransformInterceptor }]`, and remove the `useGlobalInterceptors` line.
- 3: `tap({ next: () => ..., error: () => ... })` sees both paths without changing them. Get method/url from `context.switchToHttp().getRequest()`.
- 4: `export const SkipTransform = () => SetMetadata('skipTransform', true);`. In the interceptor, inject `Reflector` and use
  `this.reflector.getAllAndOverride<boolean>('skipTransform', [context.getHandler(), context.getClass()])`. If true, `return next.handle();` unchanged. (Why does this force you to use `APP_INTERCEPTOR`?)
- 5: `next.handle().pipe(timeout(3000), catchError((err) => err instanceof TimeoutError ? throwError(() => new RequestTimeoutException()) : throwError(() => err)))`.
  Slow route: `await new Promise((r) => setTimeout(r, 10000)); console.log('slow work finished');`.
- Remove test routes afterwards.

</details>

## 12. ❓ Quiz

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
Fixes: DB-level statement timeouts, generate the report in a background job (Day 18) and notify when done, add indexes (note 12).

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
