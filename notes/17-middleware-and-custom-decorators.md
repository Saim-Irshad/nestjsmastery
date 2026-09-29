# 17 — Middleware & custom param decorators

> 📍 **Where on the Big Map:** middleware sits **outside everything Nest owns** — before guards, before interceptors, before pipes, holding the raw `req` / `res` / `next()`. Custom param decorators sit at the other end, inside the loop that builds your handler's arguments.
> 📘 **Course:** video 59 (Bonus: Add Request Logging with Middleware) · video 60 (Bonus: Create Custom Param Decorators)
> 🌿 **Branch:** `config`
> 📚 **Docs:** [Middleware](https://docs.nestjs.com/middleware) · [Custom route decorators](https://docs.nestjs.com/custom-decorators) · [Execution context](https://docs.nestjs.com/fundamentals/execution-context)

Both videos are labelled "bonus", and both are taught as syntax: here is a class with a `use()` method, here is `createParamDecorator`, look, it logs something. That leaves out the half you need, which is *which requirement makes you reach for these instead of the four blocks from note 16*. So this note starts from three requirements that land on a real backlog, and both parts are built to answer them.

---

# Part A — Middleware

## 1. The problem

Three tickets, all of which have actually been written by a real product owner somewhere this week:

1. **"Log every request with its path, status and how long it took — including the ones that 404, because we think the mobile app is calling a URL that doesn't exist any more."**
2. **"Give every request an id, put it in a response header, and put it in every log line, so when a customer says 'it broke at 2pm' support can find that one request in the logs."**
3. **"Add the standard security headers and CORS."** (That is `helmet` and `cors`, two libraries that know nothing about Nest.)

The first way anyone does number 1 is inside the handlers:

```ts
@Get()
findAll(@Query() paginationQuery: PaginationQueryDto) {
  console.log('GET /coffee', paginationQuery);        // copy-paste #1
  return this.coffeeService.findAll(paginationQuery);
}

@Get('/:id')
findById(@Param('id', ParseIntPipe) id: number) {
  console.log('GET /coffee/' + id);                   // copy-paste #2
  return this.coffeeService.findById(id);
}
```

Four things are wrong with it, and only the first one is obvious:

- It is one line per handler, forever, and the fortieth handler won't have it.
- It has no duration, because the handler doesn't know when the response actually left.
- It has no status code, for the same reason: the handler returns a value, and Nest turns that into a status *later*.
- **It cannot log a request to a URL that has no handler.** `GET /coffe/1` (typo) never reaches any of these lines, so the exact ticket that was filed — "we think the app is calling a URL that doesn't exist" — is the one thing this approach can never answer.

That last point is the whole reason middleware exists as a separate idea, and it is the thing the video doesn't say out loud.

## 2. Mental model

Note 16 drew the request as arriving at a nightclub: bouncer (guard), camera (interceptor), bag search (pipe), bar (your handler). Middleware is **the pavement outside the club**, and the doorway everyone walks through before any of the club's own staff exist:

```
   the street                        ┌──────────── the club (Nest) ─────────────┐
                                     │                                          │
 request ──► 🚧 middleware ──────────┼─► 🚪 guard ─► 🎥 interceptor ─► 🧰 pipe ─┼─► 🍸 handler
             raw req/res/next()      │                                          │
             doesn't know which      │   knows the route, the class, the method  │
             route this will be      └──────────────────────────────────────────┘
                   │
                   └─► there is no route "/typo-url" at all
                       middleware still ran. Nobody inside the club ever heard about it.
```

The frontend version you already know: this is the **service worker**, or a `fetch` wrapper you install around the whole app. It sees every outgoing call, including calls to URLs your app doesn't have a page for, and it works on raw request and response objects rather than on your components' props. An interceptor, by contrast, is the axios interceptor from note 06 — it is attached to your app's own code and only fires when your app actually handles something.

And the important claim, which note 01 already made: **middleware is not a Nest invention.** Express is an array of functions plus a `next()` that walks through them (note 01 §4). A middleware *is* one of those functions. Nest gives you a tidier way to register them and lets a class be one, and that is the entire difference.

## 3. Baby steps

### 3.1 Naive — log inside each handler

The code in section 1. What breaks: repetition, no duration, no status, and total blindness to 404s. Move on.

### 3.2 Better — a Nest interceptor

An interceptor runs before *and* after the handler (note 06), so it can measure time. Written as a class so it can hold a `Logger`:

```ts
@Injectable()
class TimingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('INTERCEPTOR');
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const t = Date.now();
    return next.handle().pipe(tap(() => this.logger.log(`${req.method} ${req.originalUrl} took ${Date.now() - t}ms`)));
  }
}
```

This is a real improvement: written once, bound once, covers every route. It answers requirement 1 for routes that exist.

**Now the catch, measured.** I ran a scratch app with *both* this interceptor (bound with `APP_INTERCEPTOR`) and a middleware, then hit one real route and one URL that doesn't exist. Real terminal output, 2026-09-27:

```
[Nest] [INTERCEPTOR] GET /coffee took 26ms
[Nest] [HTTP] 145e0755 GET /coffee 200 29.0ms
-> GET /coffee 200, x-request-id header = 145e0755
[Nest] [HTTP] 62498b94 GET /typo-url 404 0.6ms
-> GET /typo-url 404, x-request-id header = 62498b94
```

Read the four lines carefully, because three lessons are sitting in them:

1. **There is no `[INTERCEPTOR]` line for `/typo-url`.** An interceptor is attached to a *route handler*. No matching route means no handler, which means no interceptor, no guard and no pipe. The 404 is produced by Nest's fallback and the interceptor never hears about it. So the interceptor can't answer the ticket.
2. **The `[HTTP]` middleware line exists for both**, including the 404 — and it has the status code, because middleware holds the real Express `res` object and can wait for it to finish.
3. **The two durations disagree: 26ms vs 29.0ms.** The interceptor's number stops when the handler's value comes back. The middleware's number stops when the response has actually been written to the socket, so it also includes serialising to JSON and the global `TransformInterceptor`'s work. Neither is wrong; they measure different things, and if you ever put both numbers on a dashboard you need to know which one your alert is about.

### 3.3 Better — a class middleware

Two steps, because middleware is the one building block you **cannot** attach with a decorator. There is no `@UseMiddleware()`, and the reason is in the mental model: middleware doesn't know which method it's for. It is bound to a **path string**, so it has to be registered somewhere that talks about paths — the module.

**Step one, the middleware itself.** `nest g middleware logging` (the course puts it in `src/common/`, because it belongs to no feature):

```ts
// src/common/middleware/logging.middleware.ts
import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

@Injectable()                                     // a provider, like a service (note 03)
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    // requirement 2: one id per request, visible to the client and to the logs
    const id = (req.headers['x-request-id'] as string) ?? randomUUID().slice(0, 8);
    (req as any).requestId = id;
    res.setHeader('x-request-id', id);

    const started = process.hrtime.bigint();      // monotonic, unlike Date.now()

    // ⚠️ the key line. We are NOT logging here — nothing is known yet: no status,
    // no duration. We subscribe to Express's own "the response has been sent" event.
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      this.logger.log(`${id} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
    });

    next();                                       // ⚠️ forget this and the request hangs. See §7.
  }
}
```

`NestMiddleware` is an interface with exactly one required method, `use(req, res, next)`. That is the same three arguments an Express middleware function has always taken, because that is what this is.

**Step two, bind it to paths.** The module implements `NestModule`, which requires one method, `configure`:

```ts
// src/common/common.module.ts
@Module({ providers: [RequestLoggerMiddleware] })
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('{*splat}');   // every path
  }
}
```

`MiddlewareConsumer` is a tiny builder object: `apply(...middlewares)` says *what*, and `forRoutes(...)` / `exclude(...)` say *where*. That's all it is.

The output in §3.2 is this middleware running. It answers requirement 1 **and** requirement 2, for every URL the server receives, whether or not a route exists.

### 3.4 Better — functional middleware (the form you will like most)

A middleware doesn't have to be a class. A plain function with the three arguments works, and this is the shape Express has always used:

```ts
// src/common/middleware/logging.middleware.ts
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const started = Date.now();
  res.on('finish', () => console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`));
  next();
}
```

Bound identically, and both forms can go in the same `apply()` call:

```ts
consumer.apply(RequestLoggerMiddleware, requestLogger).forRoutes('{*splat}');
```

Verified, one request, real output (2026-09-27):

```
middleware:class  GET /t/7
middleware:functional /t/7
```

Registration order inside `apply()` is execution order, left to right.

**What the class buys, and it is exactly one thing: dependency injection.** The class is a provider, so its constructor can ask for anything in the module's phone book (note 13) — a `ConfigService` to read a log level, a real logging service that ships to a log collector, a repository to record slow requests. The function is created before the container exists and can't ask for anything; whatever it needs, it has to import directly or close over.

So the rule is short: **function until it needs a dependency, class after.** The course only builds the class version and mentions the function exists; in practice most middleware you write is three lines and wants no dependencies at all.

### 3.5 `app.use()` in `main.ts` — third-party middleware

`helmet` and `cors` (requirement 3) are plain Express middleware published on npm years before your app existed. They have no `@Injectable()`, no module, nothing Nest-shaped. They go in straight through the Express door:

```ts
// src/main.ts
const app = await NestFactory.create(AppModule);
app.use(helmet());                       // security headers on every response
app.enableCors({ origin: 'https://myapp.com' });   // Nest's own wrapper around the cors package
app.use(requestLogger);                  // your own functional middleware works here too
```

**What changes when you use `app.use()` instead of `configure()`.** Four things, and the first one is measured:

1. **It runs earlier.** Verified with one middleware registered each way (2026-09-27):

   ```
   app.use middleware /a
   module middleware /a
   handler A
   GET /a -> 200 A
   ```

   `app.use()` is pushed onto the Express stack while the app is being set up, before Nest attaches the middleware it collected from modules. So `app.use()` middleware always wins the race.
2. **No path filtering through Nest.** `app.use(fn)` means every path. You can pass an Express path (`app.use('/coffee', fn)`), but you don't get `exclude()` or `RequestMethod` filtering.
3. **No dependency injection at all**, not even the class form, because you are calling it yourself outside the container — the same rule as `useGlobalPipes` in note 16 §3 step 4.
4. **It is outside module encapsulation**, which is sometimes exactly what you want: body parsing, raw bodies for a Stripe webhook, `helmet`, request id generation. Things that are true of the HTTP server, not of a feature.

The rule of thumb: **`app.use()` for plumbing that came from npm; `configure()` for middleware of your own that wants a dependency or a narrow path.**

### 3.6 `forRoutes`, `exclude`, and what the wildcard is now

`forRoutes` takes several shapes, from wide to narrow:

```ts
configure(consumer: MiddlewareConsumer) {
  consumer.apply(LoggingMiddleware)
    .forRoutes('{*splat}');                                      // every path
    // .forRoutes('coffee');                                     // any path starting /coffee
    // .forRoutes('coffee/:id');                                 // one path pattern
    // .forRoutes(CoffeeController);                             // every route of a controller
    // .forRoutes({ path: 'coffee', method: RequestMethod.GET }); // GET /coffee* only
}
```

⚠️ **The wildcard changed.** The video types `forRoutes('*')`, which was the Express 4 spelling. This repo is on Nest 12, which ships Express 5 and `path-to-regexp` 8.4.2, where wildcards must be *named*: `{*splat}` or `*splat`. I checked whether the old form still starts up here, and it does — Nest 12 translates a bare `'*'` for you:

```
forRoutes('*') startup: OK
```

So the video's code runs. New code should be written `'{*splat}'`, because that's the form the docs use now and the form that won't need a rewrite. ("splat" is only the name given to the captured part; you could call it anything.)

**Prefix matching, verified** — `forRoutes('coffee')` with two controllers, 2026-09-27:

```
--- forRoutes('coffee') ---
mw GET /coffee body=undefined isDto=undefined
GET /coffee -> 200
GET /user -> 200 (middleware above? look for a mw line)
```

There is no `mw` line for `/user`. The middleware ran for the coffee prefix and nothing else.

**`exclude()` takes routes back out** of a wide binding:

```ts
consumer.apply(RequestLoggerMiddleware)
  .exclude({ path: 'health', method: RequestMethod.GET })   // don't spam the logs with load-balancer pings
  .forRoutes('{*splat}');
```

⚠️ `exclude` is worth respecting, because it has a failure mode that costs an afternoon. I excluded one route from a middleware that attaches `req.user`, then read `req.user` through a custom decorator on that route. Real output (2026-09-27):

```
mw GET /me/email
GET /me/email -> 200 {"email":"saim@example.com"}
GET /me/missing -> 200 {"v":null}
```

No `mw` line for `/me/missing`, so nothing set `req.user`, so the decorator handed the handler `undefined` — **no error, no warning, a 200 with a null**. An excluded path silently un-does every assumption later code makes about what the middleware put on the request.

### 3.7 What a senior does

Four habits, each of which comes from something going wrong once:

1. **Middleware for "a request happened", interceptor for "a handler ran".** Pick from the requirement's wording: if the sentence contains *every request*, *including 404s*, *raw*, *headers*, *before auth*, it's middleware. If it contains *the response*, *the returned data*, *this controller*, *timeout*, *cache*, it's an interceptor (note 16 §3's table).
2. **Attach a request id as early as possible, and pass it along.** `x-request-id` in the response header, in every log line, and forwarded on every outgoing call the request makes. This is the single cheapest thing you can do for future debugging: "it broke at 2pm" becomes one grep. In a bigger app the same idea is `AsyncLocalStorage` so that deep service code can read the id without every function taking it as an argument, which is the request-scoped version of React context.
3. **Keep it fast and keep it quiet.** Everything the middleware does happens on *every* request, including health checks, so a 20ms lookup there is 20ms added to the p99 of the whole API. And never log the body: see §7.
4. **Know the whole order by heart**, because security depends on it. Measured, one request, 2026-09-27:

   ```
   middleware:class  GET /t/7
   middleware:functional /t/7
   guard
   interceptor BEFORE
   decorator: data=https protocol=http
   pipe:param
   HANDLER id=7 protocol=http
   interceptor AFTER
   middleware:finish GET /t/7 -> 200
   client got 200 {"id":"7","protocol":"http"}
   ```

   Middleware → guard → interceptor (before) → pipe → handler → interceptor (after), exactly as the video claims, now with output behind it. The consequence nobody mentions: **middleware runs before your guard**, so middleware runs for requests that are about to be rejected with a 401. Anything expensive in middleware is work you do on behalf of people you are about to turn away.

📚 [Middleware consumer](https://docs.nestjs.com/middleware#middleware-consumer) · [Functional middleware](https://docs.nestjs.com/middleware#functional-middleware) · [Global middleware](https://docs.nestjs.com/middleware#global-middleware)

## 4. How it works underneath

Note 01 §4 had Express in ten lines: an array of functions and a `next()` that walks it. Middleware needs nothing more than that array:

```js
// Express, still the whole idea
const stack = [];
app.use = (fn) => stack.push(fn);

function handleRequest(req, res) {
  let i = 0;
  function next() {
    const fn = stack[i++];
    if (fn) return fn(req, res, next);     // hand control to the next function in line
    res.status(404).json({ message: `Cannot ${req.method} ${req.url}` });  // fell off the end
  }
  next();
}
```

Three behaviours drop straight out of that loop, and they're the three you keep meeting:

- **Forget `next()` and the request hangs.** The loop isn't a loop that continues by itself; the only thing that advances `i` is *your* call to `next()`. No call, no advance, no response, and the client sits there until it times out. (Verified in §7.)
- **The 404 is the end of the array**, not a special case. Nest's route handlers are entries in this array, added after your middleware. If none of them matched, control keeps walking to the fallback. Your middleware already ran, because it was earlier in the array — which is exactly why it can log a 404 and an interceptor can't.
- **Order is registration order, nothing else.** No sorting, no priorities.

`configure()` is a small piece of book-keeping on top. Roughly what Nest does at startup:

```js
// for every module that implements NestModule
const consumer = { entries: [] };
consumer.apply = (...mws) => { const e = { mws, routes: [], excluded: [] }; consumer.entries.push(e); return builder(e); };
module.configure(consumer);

// then, after the controllers' routes are known:
for (const { mws, routes, excluded } of consumer.entries)
  for (const mw of mws)
    for (const route of routes) {
      const fn = isClass(mw)
        ? (req, res, next) => container.get(mw).use(req, res, next)   // ← this is where DI happens
        : mw;                                                        // a function is already the right shape
      expressApp.use(route.path, skipIfExcluded(fn, excluded));
    }
```

The class form ends up as a function that asks the container for the instance and calls `.use()` on it. That one line is the entire difference between class and functional middleware.

And where every block ends up in the final chain, per request:

```
 socket
   │
   ▼  Express stack, in registration order
 [ app.use() from main.ts ]          helmet, cors, body parser, your global fns
 [ middleware from configure() ]     path-filtered, DI-capable
 [ Nest's route handler for GET /coffee/:id ]
      │
      ├─ guards            canActivate()          → 401/403, nothing below runs
      ├─ interceptors      before part
      ├─ argument building  pipes + custom param decorators (Part B)
      ├─ YOUR HANDLER      → service → repository → SQL
      ├─ interceptors      after part
      └─ res.json(...)     ─► fires Express's 'finish' event ─► your middleware's callback logs
 [ Nest's fallback ]                 nothing matched → 404  (middleware already ran, nothing else did)
```

## 5. Functional vs class

For once the functional version isn't a teaching device — it is a supported, first-class option, because middleware *was* a function before Nest existed.

```ts
// functional: what Express always wanted
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const t = Date.now();
  res.on('finish', () => console.log(req.method, req.originalUrl, res.statusCode, Date.now() - t));
  next();
}
```

```ts
// class: the same three arguments, wrapped in an object the container can build
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  constructor(private readonly config: ConfigService) {}         // ← the only reason to be a class
  use(req: Request, res: Response, next: NextFunction) {
    if (this.config.get('LOG_HTTP') !== 'true') return next();
    /* ...same body... */
    next();
  }
}
```

**What the class buys:** a constructor the container fills in (note 13). Once the middleware needs config, a proper logger, a feature flag or a repository, the function form has to reach for module-level imports or globals, which is the thing DI exists to avoid.

**What it costs:** a file, a decorator, an entry in `providers`, and an instance the container has to build. Also a subtlety worth knowing: the container resolves the class **per module scope**, so a class middleware can only inject what the module that configured it can see — the same encapsulation rule as any provider (note 13 §3 step 8).

**When to pick which:** function for the three-line ones (a header, a redirect, a log line). Class the moment a dependency appears. `app.use()` for anything from npm.

## 6. In my project

- **There is no middleware in this repo at all.** `grep -rn "NestMiddleware\|app.use(" src/` returns nothing. No module implements `NestModule`, and `src/app.module.ts:95` is the bare `export class AppModule {}` with no `configure()` method.
- `src/main.ts:38` — `NestFactory.create(AppModule)`. Every `app.use(...)` call would go on the lines **after** this and **before** `app.listen` at `src/main.ts:73`. That is also the gap where `helmet` and `enableCors` belong.
- `src/main.ts:54` — the global `ValidationPipe`, and `src/main.ts:69` — the global `TransformInterceptor`. Both run *after* any middleware, for matched routes only. So middleware cannot see a validated DTO and cannot change the envelope the interceptor builds.
- `src/common/` exists but holds only `dto/pagination-query.dto.ts`. That is the folder the course generates middleware into (`src/common/middleware/`), and it currently has no module of its own, so adding a `CommonModule` that implements `NestModule` is practice task 1.
- `src/utils/transform.interceptor.ts` is the closest thing the repo has to request-wide behaviour today, and note 06 §6 records that it never runs for errors or 404s. That is the same blind spot §3.2 measured.

**Where a request id would have helped already:** note 06's test table records `GET /user/999` returning a 404 with `{"message":"User with ID \"999\" not found",...}`. Nothing in that response ties it to a log line. With the middleware from §3.3 the client would hold an `x-request-id`, and the terminal line for the same request would carry it.

## 7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| Heavy work in middleware — a database lookup, a token introspection call, a JSON parse of a big body | It runs on **every** request: health checks, static assets, requests a guard is about to 401. 10ms there is 10ms on the p99 of the entire API, and it can't be opted out of per route without `exclude()` | every user of every endpoint, and whoever is paged when latency doubles after a one-line PR |
| Logging the request body | Passwords, tokens, card numbers and API keys land in plain text in your log system, get shipped to a third-party log vendor, replicated to backups and retained for a year. This is a reportable data breach, not a bug | every user whose password is now in a log file, plus the company in front of a regulator |
| Middleware that forgets `next()` | The request never advances. Nothing errors, nothing logs: the connection is held open until the client gives up. **Verified 2026-09-27:** `GET /hang -> client gave up after 1.5s: TimeoutError: The operation was aborted due to timeout`, and the handler's log line never printed. Under load these sockets pile up until the server stops accepting connections | whoever is debugging a "the API is just slow" report with no error anywhere to look at |
| Assuming middleware can read the validated DTO | It runs before pipes, so there is no DTO yet. **Verified 2026-09-27:** for `POST /coffee` with `{"name":123,"sneaky":true}` the middleware saw `body={"name":123,"sneaky":true} isDto=Object` and the request was then rejected `400 ["property sneaky should not exist","name must be a string"]`. So the middleware read the raw, unvalidated, unstripped object — including the field `whitelist` was about to delete | whoever wrote logic in middleware that trusted a field validation would have removed |
| Doing authentication in middleware | Middleware doesn't know which controller or method it's for, can't read route metadata (`@Public()`), and its only way to say no is to write a response by hand. Any route added later is protected only if someone remembered the path string | the user of the route whose path didn't match the middleware's pattern (note 16 §8) |
| Registering middleware with `app.use()` when it needs config | You called it yourself, outside the container, so nothing can be injected — the same trap as `useGlobalPipes` (note 16 §3 step 4) | the next person, who reaches for a `ConfigService` and has to rewrite the registration |
| `forRoutes('*')` copied from an old tutorial into a newer stack | On Express 5 the bare `'*'` is not a valid path pattern any more. Nest 12 still translates it (verified: `forRoutes('*') startup: OK`), but a plain Express `app.use('*', fn)` throws at startup with a `path-to-regexp` error about a missing parameter name | whoever upgrades the framework and gets a crash in a file nobody has touched in two years |

## 8. 🧠 Senior engineer lens

- **Middleware is the only layer that sees the truth about your HTTP surface.** Every other block sees the routes you successfully declared. Middleware sees what clients actually sent: the deprecated URL the old mobile app still calls, the bot scanning `/wp-login.php`, the request that was 4MB. That is where a request log has to live to be worth anything.
- **In a real service you don't `console.log`, you emit structured events.** One JSON object per request — `{ requestId, method, path, status, durationMs, userId }` — because a log line only becomes useful when a machine can group and count it. Nest's `Logger` is fine for learning; `pino-http` or an OpenTelemetry middleware is what ships. The shape of where it plugs in is identical to what you built in §3.3.
- **Request id, then trace id.** The id in §3.3 solves "find this one complaint in the logs" for a single service. The moment there are two services, you forward it (`traceparent`) so one customer's journey is one query across both. Same middleware, one more header.
- **Middleware is your escape hatch, and that is a real reason to like it.** Raw bodies for webhook signature checks, a proxy header fix, a hot-patch for a broken client that sends a malformed header — all of these need the request *before* the framework has opinions about it. Every mature app has a couple of these, and they are honest.
- **The order is a security property, not trivia.** Middleware before guards means middleware is attack surface: it runs for unauthenticated traffic, so a crash or a slow path in there is reachable by anyone on the internet. Write middleware defensively and keep it boring.
- **This shape transfers.** Express middleware, Koa middleware, ASP.NET middleware, Rails Rack middleware, Django middleware, Go's `http.Handler` wrappers: all the same idea, a chain of functions each holding the raw request and a way to call the next one. Learn it once.

## 9. 🔗 Connects to

- [01 — Express vs Nest](01-express-vs-nest-architecture.md) — where the array-of-functions-plus-`next()` model comes from; §4 here is that same sketch with middleware in it
- [16 — The four building blocks and binding](16-building-blocks-and-binding.md) — middleware is the fifth block, standing outside the other four; §3's "which tool does this requirement call for" table is the thing to re-read
- [06 — Interceptors](06-interceptors.md) — the block middleware is most often confused with. Interceptors see the response body and only matched routes; middleware sees the raw socket-level truth and every URL
- [05 — Exception filters](05-exception-filters.md) — the 404 that middleware can log and interceptors can't is produced down there
- [13 — Custom providers](13-custom-providers.md) — why the class form can inject and the function form can't
- Part B below — the other half of video 59/60's pairing: middleware puts something on `req`, a custom decorator takes it off again

## 10. ✍️ In my own words
> _(mine to write)_

## 11. 🛠️ Practice (Part A)

1. **Build the request logger for real, in this repo.** Create `src/common/common.module.ts` and `src/common/middleware/request-logger.middleware.ts`, import the module in `app.module.ts`, and get one log line per request with method, path, status and duration. Then hit a URL that doesn't exist and confirm it still logs.

   <details><summary>Hints</summary>

   - The class needs `@Injectable()`, must `implements NestMiddleware`, and must appear in the module's `providers` array — it's a provider like any service.
   - The module class needs `implements NestModule`, which forces you to write `configure(consumer: MiddlewareConsumer)`.
   - Don't log at the top of `use()`. At that moment `res.statusCode` is still the default and no time has passed. Find the Express response event that fires when the response has been sent, and log in its callback.
   - For the duration, `Date.now()` works; `process.hrtime.bigint()` is the one that can't go backwards when the clock is adjusted.
   - Nothing appears at all? Check the module is in `app.module.ts`'s `imports`, and check the path pattern.
   </details>

2. **Prove the 404 blind spot yourself.** Add a `console.log` to `src/utils/transform.interceptor.ts` and to your new middleware, then request `/coffe` (typo). Count the lines from each. Write down, in one sentence, why the two counts differ.

3. **Feel the hang.** Comment out `next()` in your middleware. Request anything. Watch what the client does and what the terminal does *not* say. Then put it back.

4. **Narrow the binding three ways.** Make the middleware run: (a) only for `/coffee*`, (b) only for `GET` requests to `/coffee`, (c) for everything except `/user`. Verify each by hitting two URLs, not one.

   <details><summary>Hints</summary>

   - `forRoutes` accepts a string, a `{ path, method }` object, or a controller class. `RequestMethod` is the enum you already met when reading about route decorators.
   - `exclude(...)` is chained **before** `forRoutes(...)` and takes the same shapes.
   </details>

5. **Attach a request id and make the app use it.** Put an id on `req` and in the `x-request-id` response header. Then make the middleware's log line and the response header agree, and check the header in the browser's network tab. Bonus: read the incoming `x-request-id` if the client sent one, so a frontend can choose the id.

6. **The `app.use()` comparison.** Register a second, functional middleware in `main.ts` with `app.use()`. Log a label from each. Which one prints first, and can you explain it from the Express array in §4 without running it again?

## 12. ❓ Quiz (Part A)

**Q1.** The ticket says: *"we think the mobile app is still calling a URL we deleted — log every request that comes in, with its status."* You write a global interceptor bound with `APP_INTERCEPTOR`. What happens, and why?

- A) It works: the interceptor sees every request
- B) It logs every request that matched a route, but **not** the deleted URL. No route means no handler, and guards, interceptors and pipes are all attached to a handler — so the 404 is produced by Nest's fallback with the interceptor never involved. The ticket needs middleware
- C) It logs the 404 but without a status code
- D) Interceptors can't read the status code at all

<details><summary>Answer</summary>

**B.** Measured in §3.2: there is an `[INTERCEPTOR]` line for `/coffee` and none for `/typo-url`, while the middleware logged both (`62498b94 GET /typo-url 404 0.6ms`). This is the single most useful thing to know about the middleware/interceptor split, and it's the reason the two features both exist.

</details>

**Q2.** A middleware measures a request at 29.0ms. An interceptor on the same request measures 26ms. Which number should go on the "API latency" dashboard, and what is the 3ms?

- A) The interceptor's, because it's closer to the handler
- B) They should be identical; one of them has a bug
- C) The middleware's, because it stops when the response has actually been written — the extra 3ms is serialising to JSON plus the global response-wrapping interceptor, which is real time the client waited for. The interceptor's number is the right one for "how slow is my handler", not "how slow is my API"
- D) Neither; only a load balancer can measure this

<details><summary>Answer</summary>

**C.** Both numbers are correct measurements of different spans, which is why a dashboard needs to say which one it is showing. Real output from §3.2, 2026-09-27: `GET /coffee took 26ms` from the interceptor, `GET /coffee 200 29.0ms` from the middleware.

</details>

**Q3.** A teammate writes middleware that strips dangerous fields out of `req.body` before the handler sees them, "as a safety net behind the ValidationPipe". What's wrong with the reasoning?

- A) Nothing, it's defence in depth
- B) Middleware can't read `req.body` at all
- C) Middleware runs **before** pipes, so it is in front of the `ValidationPipe`, not behind it. It sees the raw parsed JSON — unvalidated, and still containing the fields `whitelist: true` is about to strip — so the "safety net" is the first thing to touch the attacker's input, and any assumption it makes about the data having been checked is false
- D) `req.body` is read-only

<details><summary>Answer</summary>

**C.** Verified 2026-09-27: for `POST /coffee` with `{"name":123,"sneaky":true}` the middleware logged `body={"name":123,"sneaky":true} isDto=Object` and Nest *then* returned `400 ["property sneaky should not exist","name must be a string"]`. Note `isDto=Object` — it's a plain object, not a `CreateCoffeeDto` instance, because `class-transformer` hasn't run yet either. Validation belongs in the pipe; if the rule is a business rule, it belongs in the service (note 07 §6).

</details>

---

# Part B — Custom param decorators

## 1. The problem

The third ticket from the top of this note: **"stop writing `req.user.id` in forty handlers."**

Here is how it gets there. Once authentication exists, something early in the chain — middleware, or more usually a guard — validates the token and puts the user on the request object:

```ts
(req as any).user = { id: 42, email: 'saim@example.com', roles: ['admin'] };
```

Every handler that needs to know who is asking then does this:

```ts
@Get()
findAll(@Query() paginationQuery: PaginationQueryDto, @Req() req: Request) {
  const userId = (req as any).user.id;                         // dig it out
  return this.coffeeService.findAllFor(userId, paginationQuery);
}

@Post()
create(@Body() createCoffeeDto: CreateCoffeeDto, @Req() req: Request) {
  const userId = (req as any).user.id;                         // dig it out again
  return this.coffeeService.create(createCoffeeDto, userId);
}
```

It works. Five problems, in rising order of how much they will cost you:

1. **`@Req()` drags the entire Express request into your method.** Your controller now depends on Express. Note 01 §4 pointed out that Nest can run on Fastify instead and your controllers don't change — that stops being true for every method that takes `@Req()`.
2. **Testing gets ugly.** To unit-test `create()` you have to construct a fake request object. The method's real input is one number, and you are mocking an HTTP request to deliver it. This is the reason video 60 gives, and it's a good one.
3. **`(req as any)` everywhere.** `Request` has no `user` property, so every access is a cast, and TypeScript stops helping you. Rename `user` to `principal` in the guard and nothing fails to compile.
4. **The shape of the digging is repeated forty times.** The day it changes — `user.id` becomes `user.sub` because you moved to a standard JWT — that's forty edits, and the one you miss throws `Cannot read properties of undefined`.
5. **The handler's signature lies about what it needs.** `create(dto, req)` reads as "this needs the whole request". It needs a user id.

What we want: a handler that says `create(dto, userId)` and means it, with the digging written once.

## 2. Mental model

You already have the exact pattern in React, and it's a **custom hook**:

```jsx
// before: every component receives the whole context and digs
function Profile({ authContext }) { const email = authContext.session.user.email; }

// after: the component says WHAT it needs; the hook knows HOW to get it
function Profile() { const email = useUserEmail(); }
```

`createParamDecorator` is `useUserEmail`. It's a small function that knows how to reach into the request for one value, so the thing using it never has to.

The other way to picture it: **the built-in param decorators are not special.** `@Body()`, `@Param('id')` and `@Query('name')` are three tiny functions that read `req.body`, `req.params.id` and `req.query.name`. You are about to write a fourth one, the same way, with the same tool Nest used.

```
 Nest, building the arguments for   create(dto, userId)
 ────────────────────────────────────────────────────────
 argument 0  ── @Body()        ──► (ctx) => ctx.getRequest().body        ──► then its pipes
 argument 1  ── @ActiveUser()  ──► (ctx) => ctx.getRequest().user.id     ──► then its pipes
                                   ▲
                                   └── this function is the only thing you write
```

## 3. Baby steps

### 3.1 Naive — `@Req()` and dig

Section 1's code. What breaks: the five problems listed there.

### 3.2 Better — a plain helper function

The obvious fix for repetition. Write the digging once:

```ts
// src/common/get-user.ts
export function getUser(req: Request) {
  const user = (req as any).user;
  if (!user) throw new UnauthorizedException();
  return user as { id: number; email: string; roles: string[] };
}

@Post()
create(@Body() dto: CreateCoffeeDto, @Req() req: Request) {
  const userId = getUser(req).id;          // one line instead of a cast, in every handler
  return this.coffeeService.create(dto, userId);
}
```

This is a genuine improvement and you should notice how much it fixes: the shape of the digging lives in one file, the return type is written once, and the missing-user case throws properly.

**What's still wrong:** `@Req() req: Request` is still in the signature, so problems 1, 2 and 5 are untouched. You still can't test `create()` without faking a request, and the method still reads as "needs the whole request". And you have to remember to call `getUser`.

### 3.3 Better — `createParamDecorator`

Move the helper *up one level*, so it runs while Nest is building the arguments rather than inside the handler:

```ts
// src/common/decorators/active-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const ActiveUser = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;              // ← whatever you return BECOMES the argument
});
```

That's it. Two lines of body. And the handler becomes honest:

```ts
@Post()
create(@Body() dto: CreateCoffeeDto, @ActiveUser() user: ActiveUserData) {
  return this.coffeeService.create(dto, user.id);
}
```

**What `createParamDecorator` actually is, in plain words:** you hand it a function, and it hands you back a decorator. When a request arrives and Nest is filling in that argument, it calls your function with two things — whatever was written in the parentheses, and an `ExecutionContext` — and **whatever your function returns is the argument's value**. There is no other rule. It can return a string, a number, an object, `undefined`, a value you computed; Nest doesn't care.

`ExecutionContext` is the same object guards and interceptors get (note 06), and `switchToHttp().getRequest()` is the same two calls. The "switch" exists because Nest also runs over WebSockets and gRPC, where "the request" is a different kind of thing; `switchToHttp()` is you saying "I know this is HTTP".

The video's version reads the protocol instead of a user, and it's worth writing too because it is the shortest possible example:

```ts
export const Protocol = createParamDecorator((data: unknown, ctx: ExecutionContext) =>
  ctx.switchToHttp().getRequest().protocol,
);
```

**Verified, 2026-09-27**, with a middleware attaching `req.user` and this decorator reading it back:

```
mw GET /me/
whole: {"id":42,"email":"saim@example.com","roles":["admin"]}
GET /me/ -> 200 {"id":42,"email":"saim@example.com","roles":["admin"]}
```

And the protocol version, from the same run as the ordering experiment in Part A §3.7:

```
decorator: data=https protocol=http
HANDLER id=7 protocol=http
```

`protocol=http` because the scratch server isn't behind TLS. That one line is worth a pause: **the decorator function ran before the handler**, which is the whole point — by the time your code executes, the argument is already a plain value.

### 3.4 Passing data into it

The first parameter of your function is whatever was written inside the decorator's parentheses. That's how `@Param('id')` knows which param to read, and you get the same for free:

```ts
export const ActiveUser = createParamDecorator(
  (field: keyof ActiveUserData | undefined, ctx: ExecutionContext) => {
    const user = ctx.switchToHttp().getRequest().user;
    return field ? user?.[field] : user;        // @ActiveUser('email') → the email; @ActiveUser() → the whole object
  },
);
```

```ts
@Get('profile')
profile(@ActiveUser('email') email: string) {          // one field, typed, no request in sight
  return this.userService.findByEmail(email);
}
```

**Verified, 2026-09-27:**

```
mw GET /me/email
email: saim@example.com
GET /me/email -> 200 {"email":"saim@example.com"}
```

The video uses this argument for a default value (`@Protocol('https')`) and logs it to prove it arrives:

```
decorator: data=https protocol=http
```

Typing that first parameter as a union (`'id' | 'email' | 'roles'`, or `keyof ActiveUserData`) rather than `string` is the small move that makes the decorator safe: `@ActiveUser('emial')` becomes a compile error instead of an `undefined` at 3am.

⚠️ **The failure mode you must know about.** If nothing put `user` on the request, the decorator returns `undefined` and your handler runs anyway. Verified — I excluded one route from the middleware that sets `req.user` and hit it, 2026-09-27:

```
GET /me/missing -> 200 {"v":null}
```

No error, no warning, a **200** with a null in it. A decorator that reads something another layer promised to put there is a silent contract, and this is what a broken silent contract looks like. Two defences, and you want both: throw inside the decorator when the value is missing, and make sure the *guard* is what guarantees it (see §3.7).

### 3.5 It composes with pipes

A custom param decorator is a real parameter binding, so the second and later arguments are pipes, exactly like `@Param('id', ParseIntPipe)`:

```ts
@Get('piped')
piped(@ActiveUser('email', UpperPipe) email: string) { ... }
```

**Verified, 2026-09-27:**

```
mw GET /me/piped
UpperPipe ran
piped: SAIM@EXAMPLE.COM
GET /me/piped -> 200 {"email":"SAIM@EXAMPLE.COM"}
```

The pipe ran *after* the decorator produced the value. This is the part a plain helper function can never give you — `getUser(req).email` sits in the handler body, where no pipe can reach it. A realistic use is `@ActiveUser('id', ParseIntPipe)` when the id arrives from a token as a string.

### 3.6 Composing several decorators into one (beyond the course)

Video 60 stops at passing data. There is one more move you will meet in every real Nest codebase, so here it is. Routes tend to collect a stack of decorators that always appear together:

```ts
@UseGuards(AuthGuard, RolesGuard)
@SetMetadata('roles', ['admin'])
@ApiBearerAuth()
@Post()
create() {}
```

Four lines, repeated on every protected route, and a route that's missing one of them looks almost right. `applyDecorators` bundles them into a single decorator you write once:

```ts
// src/common/decorators/auth.decorator.ts
import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';

export const Auth = (...roles: string[]) =>
  applyDecorators(
    UseGuards(RolesGuard),
    SetMetadata('roles', roles),
    // ApiBearerAuth(),   // once Swagger is in the project
  );
```

```ts
@Auth('admin')
@Post()
create(@Body() dto: CreateCoffeeDto) { ... }
```

**Verified, 2026-09-27**, with `Auth()` built from `UseGuards(RolesGuard)` + `SetMetadata('auth', true)`:

```
mw GET /me/guarded
RolesGuard ran
guarded: 42
```

The guard inside the composed decorator ran. Note the difference in kind: `createParamDecorator` makes a **parameter** decorator that produces a value; `applyDecorators` makes a **method/class** decorator that applies other decorators. They're both "a function that returns a decorator", which is the only thing a decorator ever is.

📚 [Custom route decorators](https://docs.nestjs.com/custom-decorators) · [Passing data](https://docs.nestjs.com/custom-decorators#passing-data) · [Decorator composition](https://docs.nestjs.com/custom-decorators#decorator-composition)

### 3.7 What a senior does

- **Read only. No I/O, ever.** A param decorator should be a pure lookup on the request: read a header, read a field someone already put there, compute from what's present. The moment it does `await this.userRepo.findOne(...)` you have hidden a database query inside a method signature, and nobody reviewing the handler can see it (see §7).
- **A decorator is not authentication.** `@ActiveUser()` returning `undefined` is not a 401; it's a `TypeError` two lines later, or worse, a query with `userId: undefined` that matches the wrong rows. The **guard** decides whether the request may continue; the decorator only carries the result. This is the note 16 §3 table again: "only logged-in users" is a guard.
- **Make the contract typed and single-sourced.** Declare the shape once (`export interface ActiveUserData { id: number; email: string; roles: string[] }`), have the guard write it, have the decorator return it, and augment Express's `Request` type so `req.user` stops being `any`.
- **Name it for the domain, not the mechanism.** `@ActiveUser()` and `@CurrentTenant()` tell a reader what they get. `@FromRequest('user')` re-describes the plumbing.
- **Keep the count small.** Each custom decorator is a word your team has to learn, and a place where behaviour hides. Two or three that everyone knows are an asset; fifteen are a dialect.

## 4. How it works underneath

Note 07 §3.2 had a checker function you called by hand at the top of every handler, and the framework version moved that call into a loop Nest owns. Custom param decorators plug into **that same loop**.

Nest doesn't call your handler directly. At startup it reads the metadata each param decorator left behind and builds an argument-resolver list; per request it walks it:

```js
// roughly what Nest does, per request, per route
const resolvers = readMetadata(ControllerClass, 'create');
// [ { kind: 'body',   pipes: [validationPipe] },
//   { kind: 'custom', factory: (data, ctx) => ctx.switchToHttp().getRequest().user, data: 'email', pipes: [] } ]

const args = [];
for (const r of resolvers) {
  let value = r.kind === 'custom'
    ? await r.factory(r.data, ctx)      // ← YOUR function. Its return value is the argument.
    : readBuiltIn(r.kind, req);         // req.body / req.params[x] / req.query[x] / req
  for (const pipe of r.pipes) value = await pipe.transform(value, meta);   // pipes run after
  args[r.index] = value;
}
return controller.create(...args);      // your handler finally runs, with plain values
```

And `createParamDecorator` itself is barely more than a metadata writer. In ~10 lines:

```js
function createParamDecorator(factory) {
  return (data, ...pipes) =>                       // @ActiveUser('email', UpperPipe)
    (target, key, paramIndex) => {                 // a decorator gets these three things
      const existing = Reflect.getMetadata('custom:route-args', target.constructor, key) ?? {};
      Reflect.defineMetadata('custom:route-args', {
        ...existing,
        [`${factory.name}:${paramIndex}`]: { index: paramIndex, factory, data, pipes },
      }, target.constructor, key);
    };
}
```

Nothing is executed at decoration time except writing a note on the class. This is the same "a decorator is a function that sticks a label on something" idea the comment at `src/app.module.ts:16-38` spells out for `@Module`.

**Two measured details that fall out of that loop.** I put four parameters on one handler — two with pipes, two custom — and logged when each resolved. Real output, 2026-09-27:

```
custom:second
pipe:query-q
custom:first
pipe:param-id
HANDLER
```

1. **All arguments are resolved before the handler runs**, custom decorators and pipes interleaved in the same pass. `HANDLER` is last.
2. **The pass runs in reverse parameter order** (parameter 3 first, parameter 0 last), because that's the order the decorators registered their metadata. So never write two param decorators where one depends on the other having run — the order is an implementation detail, and it isn't the one you'd guess.

The full picture, with Part A's middleware in it:

```
 POST /coffee
   │
   ▼
 middleware            raw req/res. May put things ON the request (requestId)
   │
   ▼
 guard                 canActivate() → validates the token, sets req.user   ← the writer
   │
   ▼
 interceptor (before)
   │
   ▼
 argument building     @Body()       → req.body       → ValidationPipe → CreateCoffeeDto
                       @ActiveUser() → req.user       → (pipes)        → { id: 42, ... }   ← the reader
   │
   ▼
 handler               create(dto, user)      no @Req() anywhere in the signature
```

The middleware/guard **writes** to the request; the decorator **reads** from it. That pairing is why these two videos sit next to each other.

## 5. Functional vs class

There's no class anywhere in Part B — `createParamDecorator` takes a plain function, which is why this part should feel comfortable. The real comparison is **decorator vs plain helper function**:

```ts
// functional: a helper, called inside the handler
create(@Body() dto: CreateCoffeeDto, @Req() req: Request) {
  const user = getUser(req);                    // visible, greppable, ordinary
  return this.coffeeService.create(dto, user.id);
}
```

```ts
// decorator: the same function, moved into the argument list
create(@Body() dto: CreateCoffeeDto, @ActiveUser() user: ActiveUserData) {
  return this.coffeeService.create(dto, user.id);
}
```

**What the decorator buys:**

- **It disappears from the handler body.** The method's inputs are plain values and its body is business intent only. That is the same win as pipes (note 07) and interceptors (note 06).
- **The signature becomes the truth.** `create(dto, user)` can be unit-tested by calling it with two objects. No fake request, no Express.
- **Pipes work on it** (§3.5), which a helper call inside the body can never have.
- **It's declarative, so tools can read it.** Swagger generates docs from parameter metadata; a helper call inside a function body is invisible to anything but a human.

**What it costs, and this is a real cost:**

- **Indirection.** `user` appears in the signature with no visible source. A newcomer has to know that `@ActiveUser()` exists, find the file, and read it, to learn that a guard somewhere earlier is responsible for the value being there.
- **Harder to grep.** `getUser(` finds every use of the helper in one search, including in scripts and jobs. `@ActiveUser()` only finds the HTTP uses, and the decorator's *own* dependence on `req.user` is one level further away — so "who reads `req.user`?" now needs two searches.
- **HTTP only.** The helper can be reused by a cron job that has no request. The decorator cannot, because it needs an `ExecutionContext`.
- **A silent contract.** §3.4 measured it: remove the writer and the reader returns `undefined` with a 200.

**When to pick which:** a decorator when the value comes off the request, is needed in several handlers, and something upstream guarantees it. A plain function when the logic is also needed outside HTTP, or when it does anything more than read.

## 6. In my project

- **There are no custom decorators in this repo.** `grep -rn "createParamDecorator" src/` returns nothing, and there is no `src/common/decorators/` folder — `src/common/` holds only `dto/pagination-query.dto.ts`.
- **Every param decorator in use is a built-in one.** These are the four Nest ships, and the shapes your own decorator will copy:
  - `src/user/user.controller.ts:59` — `getUser(@Query('name') name: string)`: one named query value.
  - `src/user/user.controller.ts:100` — `getUserbyId(@Param('id', ParseIntPipe) id: number)`: a route param **plus a pipe**, which is exactly the two-argument form §3.5 verified for a custom decorator.
  - `src/user/user.controller.ts:122` — `createUser(@Body() createUserDto: CreateUserDto)`.
  - `src/user/user.controller.ts:140-142` — `updateUser(@Param('id', ParseIntPipe) id, @Body() updateUserDto)`: two bindings on one method.
  - `src/coffee/coffee.controller.ts:40` — `findAll(@Query() paginationQuery: PaginationQueryDto)`: `@Query()` with **no** name, which hands over the whole query object. The comment at `:32-38` already explains the with-name / without-name difference — your decorator's `data` argument is the same idea.
  - `src/coffee/coffee.controller.ts:46`, `:58`, `:70-71`, `:77` — the same four shapes across the coffee routes.
- **No `@Req()` anywhere.** `grep -n "@Req" src/` finds nothing, which is why the repo has stayed platform-independent so far. The first `@Req()` is the one to be suspicious of.
- **Nothing writes to the request yet.** `src/guards/guard-role.guard.ts` is still the generated stub that returns `true`, so there is no `req.user` for a decorator to read. That's why the practice below builds both halves — a middleware that writes, and a decorator that reads.
- The global `ValidationPipe` at `src/main.ts:54` has `transform: true`, which is what makes `@Query() paginationQuery` arrive as a real `PaginationQueryDto` instance rather than a plain object. A custom decorator's return value goes through the same pipe stage, so a decorator that returns a plain object and a handler that types it as a class is a mismatch you'd only notice at runtime.

## 7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| A param decorator that does database work (`await repo.findOne(...)` inside the factory) | A hidden query per request, per decorator, invisible in the handler. Two handlers using `@ActiveUser()` and `@ActiveTenant()` are two extra round trips nobody can see in the code. It also can't be cached, can't be batched, and if it throws, the error surfaces as a confusing 500 from "building an argument" | the database under load, and whoever spends a day profiling before finding it in a two-line decorator file |
| Using a custom decorator *as* authentication ("if `@ActiveUser()` is undefined the request isn't logged in") | A decorator can't stop the request. `undefined` flows into your service, and `findAll({ userId: undefined })` in TypeORM does not mean "no rows" — it can mean "this condition is ignored". **Verified 2026-09-27:** the excluded route returned `200 {"v":null}` with no error at all | whichever customer's data is returned by the query where the user filter silently vanished |
| Reading `req.user` in a decorator with nothing guaranteeing it's there | A silent `undefined` on any route that skipped the guard or was excluded from the middleware, with a 200 status. No stack trace, no log line | the person debugging "it works on every route except one" |
| Typing the `data` argument as `string` | `@ActiveUser('emial')` compiles, returns `undefined`, and fails somewhere else entirely. A `keyof` union would have caught it before the file was saved | the next developer, and the tests that didn't cover the typo |
| `@Req() req: Request` in handlers as a habit | The controller is welded to Express: no Fastify, no easy unit test, and `(req as any)` casts spread through the codebase (note 01 §4 on the adapter) | the team on the day someone proposes switching the HTTP layer, and every test that has to mock a request |
| Fifteen bespoke decorators, one per field | Every reader has to learn a private vocabulary, and each one is another place behaviour hides. `@ActiveUser('email')` beats `@ActiveUserEmail()` | every new joiner, and code review |
| A decorator that mutates the request or writes a response | Building an argument is expected to be a read. Side effects there run in an order you don't control — **measured: reverse parameter order** — and any assumption about which decorator ran first is wrong | whoever writes the second decorator that depends on the first |

## 8. 🧠 Senior engineer lens

- **The pattern is "one layer writes, another reads", and the contract deserves to be explicit.** Middleware or a guard writes `req.user`; a decorator reads it. That contract lives in nobody's type system by default, which is why it breaks silently. Make it a declared interface, augment the `Request` type, and let the decorator throw when the invariant is violated — a loud 500 beats a quiet wrong answer.
- **Decorators are a vocabulary, and vocabularies need governing.** Two or three that everyone knows (`@ActiveUser()`, `@Auth()`) make every controller shorter and more readable. Fifteen make the codebase unreadable to anyone who hasn't memorised them. This is the same judgement call as custom React hooks, and the same answer: few, well-named, documented where they're defined.
- **Testability is the argument that wins with reviewers.** A handler whose parameters are plain values is a function you can call. That's not a style preference; it's the difference between a unit test and an integration test, which is the difference between a 200ms test suite and a 40-second one.
- **`ExecutionContext` is the seam that makes Nest transport-agnostic.** `switchToHttp()` is the admission that you're hard-coding HTTP. If the same code ever needs to serve a gRPC or WebSocket entry point, every `switchToHttp()` is a place you'll have to branch — `ctx.getType()` is how you'd do it. Worth knowing the seam exists even if you never leave HTTP.
- **`applyDecorators` is how security stops being opt-in-by-memory.** One `@Auth('admin')` that bundles the guard, the metadata and the Swagger annotation means a route can't accidentally have two of the three. Same principle as note 16 §8: make the safe thing the short thing.
- **This idea isn't Nest's.** Spring's `@AuthenticationPrincipal`, ASP.NET's model binders, FastAPI's `Depends()` — every mature server framework has "a function that produces one of your handler's arguments from the request". Learning the shape here transfers to all of them.

## 9. 🔗 Connects to

- **Part A above** — the layer that puts the value on the request in the first place. Read together: middleware writes, decorator reads
- [07 — Pipes & validation](07-pipes-validation.md) — §3.2's "checker function you must remember to call" is the same story as §3.2 here, and the argument-building loop in §4 is the one pipes live in
- [16 — The four building blocks and binding](16-building-blocks-and-binding.md) — a decorator is not a guard; §3's table is how to tell
- [06 — Interceptors](06-interceptors.md) — where `ExecutionContext` and `switchToHttp()` first appeared
- [02 — Classes, objects, `this`](02-js-classes-objects-this.md) and `src/app.module.ts:16-38` — what a decorator is at all: a function that runs once and attaches a label
- [13 — Custom providers](13-custom-providers.md) — "who fills in your function's arguments" for constructors; this is the same question for handler parameters
- Course 2 (Auth) — where the guard that sets `req.user` actually gets written, and where `@ActiveUser()` stops being a practice exercise

## 10. ✍️ In my own words
> _(mine to write)_

## 11. 🛠️ Practice (Part B)

1. **Write the video's decorator.** `src/common/decorators/protocol.decorator.ts`, returning `request.protocol`. Use it on `src/coffee/coffee.controller.ts:40`'s `findAll`, log it, and confirm you get `http`.

   <details><summary>Hints</summary>

   - `createParamDecorator` comes from `@nestjs/common` and takes **one function**, whose two arguments are `(data, ctx)`.
   - The request is `ctx.switchToHttp().getRequest()`. The value you `return` is the argument.
   - Assign the result to an exported `const` with a capital letter; that const *is* the decorator.
   </details>

2. **Build both halves of the contract.** A middleware (Part A) that sets `req.user = { id: 42, email: 'saim@example.com', roles: ['admin'] }`, and an `@ActiveUser()` decorator that reads it. Prove it end to end on one coffee route.

3. **Add the `data` argument.** Make `@ActiveUser('email')` return one field and `@ActiveUser()` the whole object. Then type the argument so that `@ActiveUser('emial')` is a **compile error**, not a runtime `undefined`.

   <details><summary>Hints</summary>

   - Declare the user shape as an interface, then type the first parameter as `keyof ThatInterface | undefined`.
   - The parameter is optional, so your factory has to handle it being `undefined`.
   </details>

4. **Break it deliberately.** `exclude()` one route from the middleware, then call it. What status code comes back, and what value does the handler receive? Now make the decorator throw an `UnauthorizedException` instead. Which behaviour would you rather ship, and can you argue why this still isn't real authentication?

5. **Stack a pipe on it.** `@ActiveUser('id', ParseIntPipe)` where the middleware sets `id` as the **string** `'42'`. Confirm the handler receives the number `42`, then try to achieve the same thing with a plain helper function called inside the handler body and notice what you have to write by hand.

6. **Compose.** Write `@Auth(...roles: string[])` with `applyDecorators`, bundling `UseGuards(RoleGuard)` and `SetMetadata('roles', roles)`. Use `src/guards/guard-role.guard.ts` — make it log and return `true` for now. Confirm from the terminal that the guard inside your composed decorator ran.

7. **Measure the order for yourself.** Put four parameters on one handler, two with pipes and two custom, each logging its own name. Predict the order before you run it. Then explain the result to yourself in one sentence.

## 12. ❓ Quiz (Part B)

**Q4.** A teammate writes this, so that handlers can say `@ActiveUser() user: User` and get the full database row:

```ts
export const ActiveUser = createParamDecorator(async (_d, ctx) => {
  const id = ctx.switchToHttp().getRequest().user.id;
  return userRepository.findOneBy({ id });          // ← a query
});
```

What's the problem?

- A) `createParamDecorator` can't be async
- B) Every request that touches any handler using this decorator fires an extra database query that is **invisible at the call site**. Two such decorators on one handler is two extra round trips, uncacheable and unbatchable, and a reviewer reading the handler sees nothing. Param decorators should read from the request, not go to I/O
- C) It won't compile, because the repository isn't injected
- D) Nothing; this is the standard pattern

<details><summary>Answer</summary>

**B** is the lesson. (**C** is also a real problem — a decorator lives outside the container and can't be injected into, so getting a repository in there means a module-level import or a global, which is its own smell. That's a symptom of the same mistake.) If a handler needs the full user row, the *service* should load it from the id the decorator provided.

</details>

**Q5.** `@ActiveUser()` reads `request.user`. One route is excluded from the middleware that sets it. A request hits that route. What does the client get?

- A) 401 Unauthorized
- B) 500, because `request.user` is undefined
- C) **200**, with `undefined` passed into the handler as the user and flowing on into the service. No error, no log line, nothing to grep for
- D) The route doesn't match, so 404

<details><summary>Answer</summary>

**C.** Verified 2026-09-27: `GET /me/missing -> 200 {"v":null}`, and no middleware log line for that path. This is why a decorator is not authentication (note 16 §3: "only logged-in users" is a **guard**) and why a decorator reading a value someone else promised should throw when the promise is broken.

</details>

**Q6.** A handler has four parameters: `@Param('id', ParseIntPipe)`, `@ActiveUser()`, `@Query('q', SomePipe)`, `@ActiveUser('email')`. In what order do the four resolvers run, and what should you conclude?

- A) Left to right, parameter 0 first — so you can rely on an earlier decorator having run
- B) Custom decorators first, then built-ins with their pipes
- C) **Reverse parameter order** (parameter 3 first, parameter 0 last), with each parameter's pipes running right after its value is produced, and all four finishing before the handler. The conclusion is that the order is an implementation detail you must never depend on
- D) In parallel, since they're independent

<details><summary>Answer</summary>

**C.** Measured, 2026-09-27: `custom:second` → `pipe:query-q` → `custom:first` → `pipe:param-id` → `HANDLER`. It runs backwards because that's the order the decorators wrote their metadata, which is not a documented guarantee. Write each param decorator so it depends on nothing but the request.

</details>

**Q7.** Requirement: *"every handler that needs the logged-in user should get it without touching the request, and the same logic must also work inside a nightly cron job that has no HTTP request."* What do you build?

- A) A custom param decorator, used in both places
- B) A plain function that takes what it needs, **plus** a thin param decorator that calls it for the HTTP case. The decorator needs an `ExecutionContext`, which a cron job doesn't have, so the reusable logic has to live in an ordinary function and the decorator is the HTTP adapter on top of it
- C) Middleware, since it runs for everything
- D) A guard, since it already has the user

<details><summary>Answer</summary>

**B.** This is §5's trade-off stated as a requirement. A decorator is an HTTP-shaped wrapper; anything that must also run outside HTTP belongs in a plain function — the same reason note 01 §3 puts business rules in the service and not in the controller, so the bulk-import script can reuse them.

</details>
