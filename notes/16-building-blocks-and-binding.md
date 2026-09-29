# 16 — The four building blocks, and where to attach them

> 📍 **Where on the Big Map:** this note *is* the map. Everything between "request arrives" and "your handler runs".
> 📘 **Course:** videos 51 (Introducing More Building Blocks) · 52 (Understanding Binding Techniques). Videos 54–55 (Guards, metadata) become Part B.
> 🌿 **Branch:** `config`
> 📚 **Docs:** [Exception filters](https://docs.nestjs.com/exception-filters) · [Pipes](https://docs.nestjs.com/pipes) · [Guards](https://docs.nestjs.com/guards) · [Interceptors](https://docs.nestjs.com/interceptors) · [Middleware](https://docs.nestjs.com/middleware)

## 1. The problem

The course introduces these four as a list of features: filters, pipes, guards, interceptors, here's the syntax for each. That's the part that's easy to look up and hard to use. The two questions you actually have in front of real code are:

1. **A requirement lands on my desk. Which one of the four is the right tool?**
2. **Where do I attach it: this route, this controller, or the whole app? And what does that choice cost?**

Take four requirements that could genuinely arrive this week for the coffee API:

- "Only logged-in staff can create coffees."
- "Every response should have the same envelope so the frontend has one unwrapper."
- "`/coffee/abc` should be a 400, not a crash."
- "Errors should all look the same, and never leak stack traces."

Without a way to choose, people pick whatever they've used before. The usual result is everything in the controller:

```ts
@Post()
create(@Body() dto: CreateCoffeeDto, @Req() req) {
  if (!req.headers.authorization) throw new UnauthorizedException();   // auth, by hand
  if (typeof dto.name !== 'string') throw new BadRequestException();   // validation, by hand
  try {
    const coffee = this.coffeeService.create(dto);
    return { success: true, data: coffee };                            // envelope, by hand
  } catch (e) {
    return { success: false, message: e.message };                     // errors, by hand, with a 200 ❌
  }
}
```

Forty routes later, three of them forgot the auth check, the envelope has two shapes, and the error handling is a 200 with `success: false` (note 05). Every line above belongs to a different building block.

## 2. Mental model

A nightclub, and the queue outside it:

```
 the street         the queue                                   the bar
 (request) ──► 🚪 bouncer ──► 🎥 camera ──► 🧰 search ──► 🍸 your handler
                 guard       interceptor      pipe
                 "you may     "I'm recording  "let me check
                  come in"     the whole       and tidy what
                               visit"          you're carrying"
                                                    ✖ anything goes wrong
                                                    ──► 🧯 filter turns it into a polite answer
```

- **Guard** — a yes/no at the door. It doesn't change anything; it decides whether you get in at all.
- **Interceptor** — the camera that runs *around* the whole visit: something before, something after, and it can rewrite what you leave with.
- **Pipe** — the search: checks and tidies **one item** you're carrying (one argument), and refuses it if it's wrong.
- **Filter** — the first-aider: whenever anything throws, it decides what the client is told.

And one more you already met, standing further out on the street before the club's own staff see you: **middleware**, which is plain Express (note 01), knows nothing about your controllers, and is where CORS, cookies and body parsing live.

## 3. Baby steps

### Step 1 — Naive: all four jobs inside the handler

The code in section 1. What breaks: every job is repeated per route, each repetition can be forgotten, and all four concerns are tangled with the one thing the handler should be doing (coffee).

### Step 2 — Pull each job out, to the block designed for it

```ts
@Post()
@UseGuards(AuthGuard)                       // "may this request continue?"     → 401/403
create(@Body() dto: CreateCoffeeDto) {      // ValidationPipe already checked dto → 400
  return this.coffeeService.create(dto);    // the handler does one thing
}                                           // interceptor wraps the result     → envelope
                                            // filter catches anything thrown   → error shape
```

The handler now contains business intent and nothing else. Each cross-cutting job is declared once, by the tool built for it.

**How to pick, from the requirement's own wording:**

| The requirement says… | The block | Why it, and not the others |
|---|---|---|
| "only X may do this", "must be logged in", "admins only" | **Guard** | it answers yes/no *before* work starts, and its "no" is 401/403 |
| "every response should…", "log how long…", "time out after…", "cache this" | **Interceptor** | it needs to run before *and* after the handler, and can replace the result |
| "this parameter must be…", "convert `"5"` to `5`", "reject bad bodies" | **Pipe** | it works on one argument, and its "no" is 400 |
| "errors should look like…", "never leak internals" | **Filter** | it only runs when something throws |
| "CORS", "parse cookies", "raw request logging" | **Middleware** | it's HTTP plumbing that doesn't care which route it is |

Three that look ambiguous and aren't:

- *"Log every request"* — interceptor if you want the **duration and the result** (it sees both ends). Middleware if you only need "a request arrived" and want it to cover routes that don't exist too (middleware still runs for 404s; interceptors don't, because there's no handler).
- *"Check the user owns this coffee"* — sounds like a guard, and a guard can do it, but it needs to load the coffee from the database, which the service does anyway. Guards are for cheap, request-shaped decisions; "is this row yours" usually belongs in the service (note 04 §3.4).
- *"Reject requests over a rate limit"* — guard. It's a yes/no before work.

### Step 3 — Where to attach it: four scopes

Same block, four places, from narrowest to widest:

```ts
// 1. param-scoped (pipes only)
findOne(@Param('id', ParseIntPipe) id: number) {}

// 2. method-scoped
@UseGuards(AuthGuard)
@Post() create() {}

// 3. controller-scoped
@UseInterceptors(TransformInterceptor)
@Controller('coffee') export class CoffeeController {}

// 4. global
app.useGlobalPipes(new ValidationPipe());        // in main.ts
```

Your repo already uses two of these: `src/main.ts:54` binds `ValidationPipe` globally, and `src/coffee/coffee.controller.ts` uses `ParseIntPipe` param-scoped.

⚠️ **They stack, they don't replace.** A global pipe *and* a controller pipe means both run, in that order. A `ValidationPipe` bound globally and again on a controller validates the same body twice: same result, double the work, and any transform applied twice.

### Step 4 — The limitation of `useGlobalX`, and the fix

```ts
// main.ts
app.useGlobalPipes(new ValidationPipe());   // YOU called new → the container isn't involved
```

You wrote `new` yourself, so this object can't have anything injected into it (note 13). The moment your global filter wants a logger, or your global interceptor wants `Reflector` to read route labels, this form stops working.

The fix is to let the container build it, by registering it under a special name:

```ts
// app.module.ts
import { APP_PIPE, APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';

@Module({
  providers: [
    { provide: APP_PIPE, useClass: ValidationPipe },          // global, and injectable
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
```

These are ordinary custom providers (note 13 step 5) under names Nest recognises. Same effect as `useGlobalX`, except the object is built by the container, so it can ask for dependencies like anything else.

Two practical details:
- You can register the same `APP_*` token more than once; each entry adds another global block.
- `useGlobalX` runs outside modules, so a global filter registered that way also catches errors from places that have no module context. `APP_FILTER` is the one you want in almost every app.

### Step 5 — What a senior does: know the order, and the blast radius

**The order, measured.** I wired up one guard, interceptor and pipe at every scope in a scratch Nest app and logged a single request. Real output:

```
guard:global
guard:controller
interceptor:global BEFORE
interceptor:controller BEFORE
interceptor:method BEFORE
pipe:global
pipe:param
HANDLER
interceptor:method AFTER
interceptor:controller AFTER
interceptor:global AFTER
```

Three things fall out of that, and they're worth more than memorising the list:

1. **Guards run first, before any pipe.** A request with a bad body *and* no token gets **401, not 400**: you never spend CPU validating input from someone who isn't allowed in, and you don't leak your validation rules to strangers.
2. **Interceptors wrap everything**, including the pipes. So a timing interceptor's number includes validation time, but *not* middleware or JSON serialisation.
3. **Interceptors unwind inside-out** (global, controller, method on the way in; method, controller, global on the way out). If a controller-level interceptor rewrites the response, the global one sees the rewritten version.

**Blast radius.** The question to ask before every binding is "what happens to the routes I wasn't thinking about?"

| Binding | Blast radius | Classic accident |
|---|---|---|
| `APP_GUARD` auth guard | **every route**, including `/health` and the login route itself | the login endpoint returns 401, so nobody can ever log in |
| Global `ValidationPipe({ whitelist: true })` | every DTO in the app | a route whose body legitimately has dynamic keys loses them silently |
| Global response-wrapping interceptor | every response, including file downloads and streams | a PDF download arrives as JSON |
| `APP_FILTER` catch-all | every error everywhere | swallows a framework error and hides the real cause |

The fix in each case is the same shape: bind globally, then **label the exceptions** and read the label inside the block (`@Public()`, `@SkipTransform()`). That's what `Reflector` and `SetMetadata` are for, and it's video 55, arriving in Part B.

📚 [Binding guards](https://docs.nestjs.com/guards#binding-guards) · [Binding pipes](https://docs.nestjs.com/pipes#binding-pipes) · [Binding interceptors](https://docs.nestjs.com/interceptors#binding-interceptors) · [Binding filters](https://docs.nestjs.com/exception-filters#binding-filters)

## 4. How it works underneath

Every one of these is the same trick: Nest doesn't call your handler directly, it calls a function it wrote around your handler. Roughly:

```js
// what Nest builds per route, once, at startup
async function routeHandler(req, res) {
  for (const guard of [...globalGuards, ...controllerGuards, ...methodGuards]) {
    if (!(await guard.canActivate(ctx))) throw new ForbiddenException();   // stop here
  }

  const run = () => {
    const args = buildArgs(req);        // each arg through its pipes: global → controller → method → param
    return controller[method](...args); // your handler
  };

  const wrapped = interceptors.reduceRight((inner, i) => () => i.intercept(ctx, { handle: inner }), run);

  try {
    res.json(await lastValueFrom(wrapped()));
  } catch (err) {
    findFilter(err).catch(err, host);   // method → controller → global → built-in
  }
}
```

You've seen every piece of this before: the onion from note 06 §4, the argument-building loop from note 07 §3.2, and the try/catch from note 05 §3.1. This is them in one function, in the order the experiment above printed.

Where each binding ends up:

```
 scope        stored as                      read when
 ─────────────────────────────────────────────────────────────────
 param        metadata on the parameter      building that argument
 method       metadata on the method         handling that route
 controller   metadata on the class          handling any of its routes
 global       a list on the app              every route
 APP_*        a provider in the container →  every route (and injectable)
```

## 5. Functional vs class

You've written all four of these in functional code without the names:

```js
const withAuth      = (handler) => (req, res) => (req.user ? handler(req, res) : res.status(401).end());  // guard
const withTiming    = (handler) => async (req, res) => { const t = Date.now(); const r = await handler(req, res); log(Date.now() - t); return r; };  // interceptor
const parseId       = (raw) => { const n = Number(raw); if (!Number.isInteger(n)) throw new BadRequest(); return n; };  // pipe
const withErrorShape= (handler) => async (req, res) => { try { return await handler(req, res); } catch (e) { res.status(e.status ?? 500).json({ message: e.message }); } };  // filter

app.get('/coffee/:id', withAuth(withTiming(withErrorShape(handler))));   // "binding", by hand
```

**What the class version buys:** you stop writing that wrapping chain per route and, crucially, you stop *forgetting* it on the fortieth route. Binding once globally covers everything, including routes added next year by someone who never read this file.

**What it costs:** the wrapping is invisible. Reading `create()` tells you nothing about the four things that run around it, and a global binding added in `app.module.ts` changes the behavior of files nobody touched. That's the trade every framework of this kind makes: fewer mistakes of omission, more action at a distance.

## 6. In my project

- `src/main.ts:54` — `app.useGlobalPipes(new ValidationPipe({...}))`: global scope, `new`-built, so nothing can be injected. Moving it to `APP_PIPE` in `app.module.ts` is practice task 2.
- `src/main.ts:69` — `app.useGlobalInterceptors(new TransformInterceptor())`: same story (note 06 §6).
- `src/coffee/coffee.controller.ts` — `@Param('id', ParseIntPipe)`: param scope, the narrowest binding.
- **No guards and no filters yet.** The `src/guards/guard-role.guard.ts` file generated earlier is an empty stub that returns `true`. The first real one arrives in the auth course.
- The error shape is still Nest's default, because nothing is bound as a filter (note 05 §6).

## 7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| Do auth/validation/envelope work inside handlers | Every route repeats it; one gets forgotten | the user whose data leaks through the route that forgot |
| Bind an auth guard globally with no way out | `/health`, `/login` and the docs page all return 401; the app looks completely broken | you, in the first five minutes of deploying it |
| Bind the same `ValidationPipe` globally and on a controller | Runs twice: double work, double transform | throughput, and whoever debugs a doubly-transformed value |
| Use `useGlobalX` for something that needs a dependency | You can't inject; people work around it with imports and globals | the next person who needs a logger in there |
| Wrap every response with an interceptor, including downloads | Files and streams get JSON-ified | whoever downloads the invoice |
| Use a guard for "does this row belong to you" | It loads the row, then the service loads it again; two queries and split logic | the database, and whoever keeps them in sync |
| Put business rules in a pipe | The rule only applies to HTTP callers; a cron job skips it entirely | data integrity (note 07 §6) |
| Assume decorator order above a method matters | It doesn't change execution order: guards always run before pipes, whatever the order you typed | you, debugging the wrong thing |

## 8. 🧠 Senior engineer lens

- **Cross-cutting concerns want a single place.** The whole point is that "authentication happens" is a property of the *application*, not something re-decided in each of forty handlers. Anything that must never be forgotten belongs at the widest scope with explicit exceptions, not at the narrowest scope repeated by hand.
- **Global + opt-out beats local + remember.** `APP_GUARD` plus `@Public()` fails safely (a new route is protected until someone marks it open). Per-route guards fail open (a new route is unprotected until someone adds the decorator). Choose the default that's safe when someone is careless, because someone will be.
- **Know what runs before what, because security depends on it.** Guards before pipes means unauthorised requests never reach your validation. If you ever move a check into the wrong layer, you can leak behaviour to people who shouldn't get that far.
- **Every global binding is a change to code you didn't open.** Write down the blast radius in the PR description, and grep for routes that will be affected. This is where "it worked in dev" incidents come from.
- **These four blocks are not unique to Nest.** Middleware, filters, interceptors and guards are the same ideas as Spring's filters/interceptors, ASP.NET's middleware and filters, Rails' before_action. Learning the shape transfers.

## 9. 🔗 Connects to
- [05 — Exception filters](05-exception-filters.md), [06 — Interceptors](06-interceptors.md), [07 — Pipes & validation](07-pipes-validation.md): each block in depth
- [13 — Custom providers](13-custom-providers.md): what `APP_GUARD` and friends actually are
- [01 — Express vs Nest](01-express-vs-nest-architecture.md): middleware, the block that isn't Nest's
- Part B (videos 54–55): guards properly, and `SetMetadata` + `Reflector` for the opt-out labels
- Course 2 (Auth): the real `AuthGuard` and `@Public()`

## 10. ✍️ In my own words
> _(mine to write)_

## 11. 🛠️ Practice

1. **Reproduce the order.** Create `practice/binding-demo.ts` with the code below, compile and run it, and check you get the same eleven lines as section 3 step 5.

   <details><summary>The file</summary>

   ```ts
   import { Controller, Get, Module, Param, PipeTransform, Injectable, CanActivate,
            NestInterceptor, ExecutionContext, CallHandler, UseGuards, UseInterceptors } from '@nestjs/common';
   import { NestFactory, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
   import { Observable, tap } from 'rxjs';

   const log: string[] = [];

   function interceptor(label: string) {
     @Injectable()
     class I implements NestInterceptor {
       intercept(_ctx: ExecutionContext, next: CallHandler): Observable<any> {
         log.push(`${label} BEFORE`);
         return next.handle().pipe(tap(() => log.push(`${label} AFTER`)));
       }
     }
     return I;
   }
   function guard(label: string) {
     @Injectable()
     class G implements CanActivate { canActivate(): boolean { log.push(label); return true; } }
     return G;
   }
   @Injectable() class GlobalPipe implements PipeTransform { transform(v: any) { log.push('pipe:global'); return v; } }
   @Injectable() class ParamPipe  implements PipeTransform { transform(v: any) { log.push('pipe:param');  return v; } }

   @Controller('t')
   @UseGuards(guard('guard:controller'))
   @UseInterceptors(interceptor('interceptor:controller'))
   class Ctrl {
     @Get('/:id')
     @UseInterceptors(interceptor('interceptor:method'))
     find(@Param('id', ParamPipe) id: string) { log.push('HANDLER'); return { id }; }
   }

   @Module({
     controllers: [Ctrl],
     providers: [
       { provide: APP_GUARD, useClass: guard('guard:global') },
       { provide: APP_INTERCEPTOR, useClass: interceptor('interceptor:global') },
     ],
   })
   class M {}

   (async () => {
     const app = await NestFactory.create(M, { logger: false });
     app.useGlobalPipes(new GlobalPipe());
     await app.listen(3991);
     await fetch('http://localhost:3991/t/7').then((r) => r.json());
     console.log(log.join('\n'));
     await app.close();
   })();
   ```

   ```bash
   npx tsc --ignoreConfig --experimentalDecorators --emitDecoratorMetadata --target ES2022 \
     --module commonjs --moduleResolution node --skipLibCheck --outDir practice/dist practice/binding-demo.ts
   node practice/dist/binding-demo.js
   ```

   </details>

2. **Move the globals into the container.** Replace `useGlobalPipes`/`useGlobalInterceptors` in `main.ts` with `APP_PIPE` and `APP_INTERCEPTOR` providers in `app.module.ts`. Confirm the app behaves identically. Then inject something (a `Logger`) into the interceptor and notice this only works now.
3. **Make a guard that denies.** A guard returning `false`: what status code does the client get, and what does the response body look like? Then throw `new ForbiddenException('nope')` instead. Which gives the better message?
4. **Feel the double-binding.** Bind `ValidationPipe` globally *and* on `CoffeeController`, and put a `console.log` in a custom pipe to count how many times it runs for one request.
5. **Blast radius.** Bind a guard globally that returns `false` unless the request has header `x-key`. Now try `GET /coffee` and `GET /`. How many routes did you just break, including ones you forgot existed?

## 12. ❓ Quiz

**Q1.** A request arrives with an invalid body **and** no auth token. A global guard and a global `ValidationPipe` are both bound. What does the client get, and why does the order matter for security?

- A) 400, because the body is checked first
- B) 401, because guards run before pipes: unauthenticated requests never reach validation, so you neither spend CPU on them nor reveal your validation rules
- C) Both errors, combined
- D) Depends on the order of the decorators above the handler

<details><summary>Answer</summary>

**B.** Verified by the measured order: `guard:global` prints before any pipe. **D** is a common belief and wrong: decorator order in the file doesn't change the pipeline.

</details>

**Q2.** Three interceptors are bound: global, controller and method. Which order do their "after" parts run in, and what's the practical consequence?

- A) global, controller, method: the same as going in
- B) method, controller, global: they unwind inside-out, so whatever an inner one does to the response is what the outer one sees
- C) Only the innermost runs
- D) Undefined

<details><summary>Answer</summary>

**B.** From the measured output. Consequence: if a controller interceptor rewrites the body, a global logging interceptor logs the rewritten body, not the handler's return value.

</details>

**Q3.** Your team binds an `AuthGuard` with `APP_GUARD`. The next deploy, monitoring goes red and nobody can log in. What happened, and what's the fix?

- A) The guard is broken; roll back
- B) It applies to **every** route, including `/health` and the login endpoint. The fix is to keep it global and mark the exceptions with a label the guard reads (`@Public()` + `Reflector`)
- C) `APP_GUARD` can't be used with auth
- D) Guards don't run for GET requests

<details><summary>Answer</summary>

**B.** And "global with opt-out" is still the right design: it fails safe. A new route is protected by default, instead of unprotected until someone remembers a decorator.

</details>

**Q4.** Why can't `app.useGlobalFilters(new AllExceptionsFilter())` use an injected logger, while `{ provide: APP_FILTER, useClass: AllExceptionsFilter }` can?

- A) Filters can't have dependencies
- B) Because you called `new` yourself, outside the container: whoever calls `new` provides the arguments (note 13). The `APP_FILTER` form lets the container build it, so it fills the constructor from the phone book
- C) `useGlobalFilters` is deprecated
- D) It works in both; the docs are wrong

<details><summary>Answer</summary>

**B.** The same rule that explains why `ValidationPipe` in `main.ts` can't be injected into either.

</details>

**Q5.** Requirement: *"every response should include how long the request took, and slow ones should be logged."* Which block, and why not the others?

- A) Middleware, because it runs first
- B) An interceptor: it's the only block that runs both **before** and **after** the handler, and can modify the outgoing response
- C) A pipe, because it transforms
- D) A filter, because it wraps the handler

<details><summary>Answer</summary>

**B.** Middleware could time the request but can't touch the response body Nest is about to serialise; pipes see one argument; filters only run on errors.

</details>

**Q6.** A teammate binds a response-wrapping interceptor globally. A week later, `GET /invoice/:id/pdf` starts returning JSON instead of a file. What's the underlying lesson?

- A) Interceptors are unsafe
- B) Every global binding silently changes routes nobody re-tested, including ones added later. Wide bindings need an opt-out label (`@SkipTransform()`) and a note in the PR about the blast radius
- C) PDFs must be served by middleware
- D) The interceptor was written wrong

<details><summary>Answer</summary>

**B.** Note 06's "how not to" table lists this exact case. Convenience at the global scope is bought with action at a distance.

</details>

---

# Part B — Guards, and labelling routes with metadata

> 📍 **Where on the Big Map:** the very first block after Express plumbing. Guards run before pipes, before interceptors touch an argument, before your handler exists as far as the request is concerned.
> 📘 **Course:** videos 54 (Protect Routes with Guards) · 55 (Using Metadata to Build Generic Guards or Interceptors)
> 🌿 **Branch:** `config`
> 📚 **Docs:** [Guards](https://docs.nestjs.com/guards) · [Binding guards](https://docs.nestjs.com/guards#binding-guards) · [Setting roles per handler](https://docs.nestjs.com/guards#setting-roles-per-handler) · [Execution context](https://docs.nestjs.com/fundamentals/execution-context) · [Custom route decorators](https://docs.nestjs.com/custom-decorators)

## B1. The problem

The two videos show you an `ApiKeyGuard`, then `SetMetadata`, then `Reflector`, in that order, and each one is three lines of syntax. That's the part that is easy to copy and impossible to place. So start from the other end, with a requirement that could arrive on a real ticket:

> The coffee API is going public next week. Partners get a key. **Only requests carrying a valid key may create, change or delete coffees.** But: `GET /coffee` is the shop's public menu and must stay open to anyone, and the load balancer's health check hits `GET /` every five seconds with no key at all, and must keep getting a 200 or the machine gets pulled out of rotation.

Read that again and notice its shape. It is not "add auth". It is **one rule that applies to everything, with two named exceptions, and the exception list will grow** (the docs page, the webhook the payment provider calls, the login route in the next course). Every design decision in the rest of this part comes out of that one sentence.

Here is the version you write if you have no tools yet, straight into `src/coffee/coffee.controller.ts`:

```ts
@Post()
create(@Body() dto: CreateCoffeeDto, @Req() req: Request) {
  if (req.headers.authorization !== process.env.API_KEY) {
    throw new UnauthorizedException('Provide a valid API key');   // ← the rule, by hand
  }
  return this.coffeeService.create(dto);                          // ← the actual job
}
```

It works. For one route. Then `@Patch`, `@Delete`, the two routes you add next month, and the route a teammate adds in a branch you never review. The rule now lives in a copy per route, and each copy can be forgotten, and forgetting it is silent: the route works perfectly, for everybody, including the person you were trying to keep out. There is no test that fails and no error in the log. You find out from a bill or a breach.

There is a second thing wrong with it that matters less on day one and more on day one hundred: `create()` now has two jobs, and the auth one is the noisier one. The handler you want to read six months later is the one that says "make a coffee".

## B2. Mental model

The bouncer from Part A, with one addition: **a guest list on the door of each room**.

```
                                           ┌──────────────────────────────────┐
                                           │  the door of GET /coffee         │
 request ──► 🚪 ApiKeyGuard ──── reads ───► │  sticky label: "public: true"    │
              │                            └──────────────────────────────────┘
              │ label says public?  ──► yes ──► wave them through
              │
              └─ no ──► does the header match the key we hold?
                          yes ──► in you go ──► pipes ──► handler
                          no  ──► 🧯 filter ──► 401 Unauthorized
```

The bouncer is **one person** who knows **one rule**. He does not carry a list of forty room names in his head. Each door tells him how it wants to be treated, and he can read. That split is the whole idea: the guard stays generic (it never mentions `/coffee`), and the knowledge about a particular route stays on that route.

You already know the sticky-label half of this. `@Module({...})` (note 03) does not change how `AppModule` behaves; it attaches a note to the class that Nest reads later. `@Column()` on an entity field does not change the field; it attaches a note TypeORM reads when it builds the SQL. `@SetMetadata('isPublic', true)` is the same move, and this time **you** are the one who reads the note back.

## B3. Baby steps

### Step 1 — Naive: the check inside the handler

The code in B1. What's wrong: the rule is copied per route, each copy can be forgotten, forgetting it fails open, and the handler now has two jobs. The fix is to move the check out to something that runs before the handler and cannot be skipped by accident.

### Step 2 — A guard, bound to one route

A guard is a class with one method that answers one question: may this request continue? Nest calls it, looks at what came back, and either runs your handler or ends the request.

```ts
// src/common/guards/api-key.guard.ts        (nest g guard common/guards/api-key)
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

@Injectable()                                        // the container is allowed to build it
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();     // note 06 §4.7
    if (req.headers.authorization !== process.env.API_KEY) {
      throw new UnauthorizedException('Provide a valid API key');
    }
    return true;                                     // true → carry on. false → Nest denies.
  }
}
```

`canActivate` may return a boolean, a `Promise<boolean>` or an `Observable<boolean>`; Nest waits for whichever it gets. `ExecutionContext` is the same "where am I?" object the exception filter and the interceptor were handed (note 05, note 06 §4.7): `switchToHttp().getRequest()` gives you the Express request, and two more methods on it become important in step 5.

Bind it to the route that needs it:

```ts
@Get()  @UseGuards(ApiKeyGuard)  findAll() { ... }
```

Real behaviour, from a scratch Nest app built from the same shapes as your controller (run 2026-09-27; the guard reads its key from an injected service, so this also proves a route-scoped guard gets dependencies injected — Nest builds it from the class you passed):

```
guarded route, no header:            HTTP 401 {"message":"Provide a valid API key","error":"Unauthorized","statusCode":401}
guarded route, correct key:          HTTP 200 ["latte"]
route nobody decorated, no header:   HTTP 200 {"id":1}          ← ⚠️
```

**What's still wrong** is that third line, and it is the same disease as step 1 wearing a nicer shirt. The rule is now written once, but **remembering it is still per route**. `@UseGuards` on the controller instead of the method widens it to one controller, which helps until someone adds the second controller. Any design where protection arrives because a human remembered a decorator **fails open**: the default state of a brand-new route is unprotected.

### Step 3 — Before going wider: `return false` versus `throw`

Two ways for a guard to say no, and they are not the same answer to the client. Measured, same date, same scratch app:

```
// canActivate() { return false; }
GET /coffee -> HTTP 403 Forbidden
{"message":"Forbidden resource","error":"Forbidden","statusCode":403}

// canActivate() { throw new UnauthorizedException('Provide a valid API key in the authorization header'); }
GET /coffee -> HTTP 401 Unauthorized
{"message":"Provide a valid API key in the authorization header","error":"Unauthorized","statusCode":401}
```

`false` is Nest's generic refusal: it throws `ForbiddenException` for you, so you get **403** and the fixed string `"Forbidden resource"`, with no way to say why. Throwing yourself gets you the right code and your own message, and it goes through your exception filters like any other error (note 05), so it comes out in whatever error shape the rest of your API uses.

Which code is right matters more than it looks:

| | Meaning | Use when |
|---|---|---|
| **401 Unauthorized** | "I don't know who you are" | no key, malformed key, wrong key, expired token |
| **403 Forbidden** | "I know who you are, and you may not do this" | valid key, but this partner isn't allowed to delete coffees |

Frontends branch on this. A 401 means "send me to the login screen / refresh the token"; a 403 means "show 'you don't have permission', and do not log the user out". Returning 403 for a missing key sends the browser down the wrong path, and a client written against your API will loop forever refreshing a token that was never the problem.

### Step 4 — Bind it globally, and watch the app fall over

The requirement says the rule applies to everything, so bind it to everything. Not with `app.useGlobalGuards()` — the guard needs the key from somewhere, and Part A step 4 explains why a `new`-built global can't be injected into. Use the container:

```ts
// src/common/common.module.ts      (nest g mo common)
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeyGuard } from './guards/api-key.guard';

@Module({
  providers: [{ provide: APP_GUARD, useClass: ApiKeyGuard }],   // an ordinary custom provider (note 13 §3.3)
})
export class CommonModule {}
```

Now the rule is true by default and cannot be forgotten. It is also, at this exact moment, a broken application. Measured, no `authorization` header:

```
GET /coffee        -> HTTP 401   ← the public menu. Should be 200.
GET /              -> HTTP 401   ← the health check. The load balancer now believes every instance is sick.
```

That second line is the failure a senior predicts out loud before writing the code, and Part A §3 step 5 lists it in the blast-radius table for exactly this reason. Its consequences are worse than "one endpoint is wrong": the health check failing on every instance means the load balancer takes them all out of rotation, so the site is down, and it is down in a way that looks like an infrastructure problem rather than the four-line provider somebody merged.

And it is not enough to walk it back to per-route binding. Global-with-exceptions and per-route-when-remembered are not two tastes; one **fails safe** and the other **fails open** (Part A §8). So keep the global binding, and give routes a way to say "not me".

One subtlety worth knowing before you rely on this: a global guard only runs for requests that **matched a route**. Measured:

```
GET /coffee          -> 401 {"message":"no key",...}                  (guard ran)
GET /does-not-exist  -> 404 {"message":"Cannot GET /does-not-exist"}  (guard never ran)
```

So an unauthenticated stranger can still tell which of your paths exist, because existing ones answer 401 and missing ones answer 404. That is route enumeration, it is usually accepted, and it is worth knowing you accepted it.

### Step 5 — Label the exceptions: `SetMetadata` + `Reflector`

Two halves. Write the label on the route:

```ts
// src/coffee/coffee.controller.ts
@Get()
@SetMetadata('isPublic', true)          // ← a sticky note on this method
findAll(@Query() paginationQuery: PaginationQueryDto) { ... }
```

And read it back inside the guard, at request time, through a helper Nest gives you called `Reflector`:

```ts
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}          // from @nestjs/core

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),     // the method about to run, e.g. CoffeeController.prototype.findAll
      context.getClass(),       // the controller class, e.g. CoffeeController
    ]);
    if (isPublic) return true;                                   // ← the opt-out, checked first

    const req = context.switchToHttp().getRequest<Request>();
    if (req.headers.authorization !== process.env.API_KEY) {
      throw new UnauthorizedException('Provide a valid API key in the authorization header');
    }
    return true;
  }
}
```

`context.getHandler()` hands you the actual function Nest is about to call, and `context.getClass()` the controller class it lives on. Those are the two things labels can be attached to, which is why you pass both. Measured, with the label on `findAll` and a class-level label on a `/health` controller (the guard logged both lookups on every request):

```
[guard] C3.findAll      getAllAndOverride=true       get(handler)=true
GET /coffee            -> 200 ["latte"]                               ← public, no header needed
[guard] C3.findOne      getAllAndOverride=undefined  get(handler)=undefined
GET /coffee/one        -> 401 {"message":"Provide a valid API key in the authorization header",...}
GET /coffee/one (wrong key)   -> 401  (same body)
GET /coffee/one (correct key) -> 200 {"id":1}
[guard] Health3.ping    getAllAndOverride=true       get(handler)=undefined     ← ⚠️ look at this one
GET /health            -> 200 {"status":"ok"}
```

That `Health3.ping` line is the argument for passing both targets. The label was put on the **controller** (`@Public()` above `class HealthController`), so the lookup against the handler alone came back `undefined` — the video's `reflector.get(KEY, context.getHandler())` would have denied the health check while the label sat right there in the file. `getAllAndOverride` walks the array in order and returns the first value that isn't `undefined`, so a method-level label wins over a class-level one and a class-level one still works when there's no method label. That ordering is also the behaviour you want: a controller can declare "everything in here is open", and a single method inside it can be labelled differently.

⚠️ The one thing `getAllAndOverride` does **not** do is let a method turn a class-level `true` back into `false` by absence. If the class says public, every method in it is public unless it carries its own label. Labelling a whole controller open is a decision with the blast radius of the controller.

### Step 6 — Stop writing the string twice: your own `@Public()` decorator

`'isPublic'` currently appears in two files, as a string, with nothing connecting them. Misspell it in one place (`'ispublic'`) and you get no error at all, at compile time or at run time: the guard reads `undefined`, decides the route is not public, and returns 401 for a route you believe you opened. That is a typo that looks like a security bug.

A decorator is a function that returns a decorator, so you can wrap it yourself:

```ts
// src/common/decorators/public.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';                    // the one place the string lives
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

```ts
@Get()
@Public()                                                    // reads like the requirement does
findAll(@Query() paginationQuery: PaginationQueryDto) { ... }
```

```ts
const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
  context.getHandler(), context.getClass(),
]);
```

Three things you bought: the string exists once so a typo is a compile error, the call site reads like the ticket ("this route is public") rather than like a storage operation, and if the shape ever needs to change (`@Public()` becoming `@Public({ rateLimit: 10 })`) you change one file instead of grepping for a string.

**Going past the course:** Nest has a version of this with no string at all. `Reflector.createDecorator` makes the key for you and ties the label's type to the decorator, so the lookup can't drift from the definition:

```ts
export const Public = Reflector.createDecorator<boolean>();      // no key, no magic string

// in the guard — the decorator IS the key, and the return type is inferred
const isPublic = this.reflector.getAllAndOverride(Public, [context.getHandler(), context.getClass()]);
```

Measured with that version, and it exposes one wrinkle worth knowing:

```
[guard] findAll isPublic=true     /coffee     -> 200 ["latte"]          ← @Public(true)
[guard] findTwo isPublic={}       /coffee/two -> 200 ["flat white"]     ← @Public()  with no argument
[guard] findOne isPublic=undefined /coffee/one -> 401                    ← no label
```

`@Public()` with no argument stores `{}`, which is truthy, so it happens to work — but if you ever write `if (isPublic === true)` it stops working, and `@Public(false)` stores `false` and denies. With `createDecorator`, pass the value explicitly (`@Public(true)`) or read it as a truthiness check and know why.

### Step 7 — What a senior does

**Get the key from config, not `process.env`.** `process.env.API_KEY` is a string-or-undefined read at the moment the request arrives, with nothing checking it was ever set. A guard whose key is `undefined` will happily let through a request whose header is also absent in some comparison shapes, and at best you find out with a 401 storm in production. Inject `ConfigService` and validate the variable at startup so the app refuses to boot without it (note 15). Video 55 makes this swap too.

**Remember why this guard forces you into `APP_GUARD`.** The moment the guard has a constructor (`Reflector`, `ConfigService`), `app.useGlobalGuards(new ApiKeyGuard())` cannot work, because you are the one calling `new` and you have nothing to pass (note 13, Part A step 4). It is not a compile-time-only problem. Measured, with the argument left out:

```
GET /coffee -> HTTP 500 {"statusCode":500,"message":"Internal server error"}

# and in the server log:
ERROR [ExceptionsHandler] TypeError: Cannot read properties of undefined (reading 'getAllAndOverride')
    at ApiKeyGuard.canActivate (...)
```

Every route in the app becomes a 500 — and note which way that fails. A crashing auth guard denies everybody, which is ugly but safe. A guard that swallows its own errors and returns `true` on failure is the same bug with the opposite ending.

**Know that guards run before pipes, and use it.** From Part A's measured order, and confirmed here end to end with a global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` bound alongside the guard:

```
POST /coffee  {"name": 42, "hacker": true}  no key       -> 401 {"message":"Provide a valid API key...",...}
POST /coffee  {"name": 42}                  correct key  -> 400 {"message":["name must be a string"],"error":"Bad Request","statusCode":400}
```

The stranger with a malformed body learns **nothing** about your DTOs: no field names, no rules, no hint that `hacker` is rejected by name. The partner with a real key gets the helpful message. You also stop spending class-validator CPU on unauthenticated traffic, which is what saves you during a scripted attack.

**Keep the guard cheap and request-shaped.** This one compares two strings. A guard that opens a database connection runs on every request including the ones that end in 404-ish nonsense, and it runs before any caching interceptor. If a decision needs a row from your database ("is this coffee yours"), Part A §3 step 2 explains why that usually belongs in the service instead.

**The name for all of this:** the class is a **guard**, the sticky note is **route metadata**, the reader is the **Reflector**, and `@Public()` is a **custom decorator**. The pattern of "one global rule plus per-route labels that opt out" is worth more than any of the four names, and you will use it again for `@Roles('admin')`, `@SkipTransform()`, `@SkipThrottle()` and `@CacheTTL(60)`.

📚 [Setting roles per handler](https://docs.nestjs.com/guards#setting-roles-per-handler) is the same pattern with roles instead of a boolean · [Custom route decorators](https://docs.nestjs.com/custom-decorators) for the `@Public()` half · [Execution context](https://docs.nestjs.com/fundamentals/execution-context) for `getHandler()`/`getClass()`.

## B4. How it works underneath

There is no reflection magic here, and `Reflector` is about twenty lines of code. The whole mechanism is a `Map` hidden on the function object.

**`SetMetadata` writes.** It is a decorator factory: called with a key and a value, it returns a function that Nest (well, TypeScript) applies to your method, and that function writes the value onto the method's own function object:

```js
// roughly what @SetMetadata('isPublic', true) does
function SetMetadata(key, value) {
  return (target, propertyKey, descriptor) => {
    if (descriptor) {
      Reflect.defineMetadata(key, value, descriptor.value);   // descriptor.value IS the method function
      return descriptor;
    }
    Reflect.defineMetadata(key, value, target);               // no descriptor → it was on the class
  };
}
```

I checked that this is literally where the value lands. Compiling a controller with `@Get() @Public() findAll()` and asking `Reflect` directly:

```
on the method:                 true
on the undecorated method:     undefined
own metadata keys on findAll:  [ 'isPublic', 'path', 'method' ]
own metadata keys on the class:[ '__controller__', 'path', 'host', 'scope:options', '__version__' ]
hand-rolled equivalent:        true
```

Your `isPublic` sits on `CoffeeController.prototype.findAll` next to the `path` and `method` labels `@Get()` put there. Same shelf, same mechanism — `@Get()` is not a different kind of thing from your decorator, it was written first. The last line is a hand-rolled decorator doing `Reflect.defineMetadata('isPublic', true, descriptor.value)` with no Nest involved, and it produces the same result.

**`Reflector` reads.** Here is the real source from `@nestjs/core/services/reflector.service.js` in your `node_modules`, trimmed:

```js
get(metadataKeyOrDecorator, target) {
  const metadataKey = metadataKeyOrDecorator.KEY ?? metadataKeyOrDecorator;
  return Reflect.getMetadata(metadataKey, target);                  // that's all of it
}
getAllAndOverride(metadataKeyOrDecorator, targets) {
  for (const target of targets) {
    const result = this.get(metadataKeyOrDecorator, target);
    if (result !== undefined) return result;                        // first one that exists wins
  }
  return undefined;
}
```

`get` is one line. `getAllAndOverride` is a `for` loop over the targets you passed, returning the first value that isn't `undefined` — which is exactly why `[getHandler(), getClass()]` means "method label first, controller label as the fallback", and why swapping the order would let a controller override its own methods. (`getAllAndMerge` exists for the cases where you want both, e.g. collecting roles from class and method into one array.) The `.KEY` line is how `Reflector.createDecorator` works: the decorator it returns carries its own generated key as a property, so you can hand the decorator itself in where a string used to go.

**The whole request, with files:**

```
GET /coffee/1                (no authorization header)
  │
  ├─ Express matches a registered route   → if nothing matches: 404, and no guard runs
  │
  ├─ Nest builds an ExecutionContext for it:
  │      getHandler() → CoffeeController.prototype.findById      (the function object)
  │      getClass()   → CoffeeController                          (the class)
  │
  ├─ guards, widest first:  APP_GUARD (common.module.ts) → controller → method
  │      ApiKeyGuard.canActivate(context)                   src/common/guards/api-key.guard.ts
  │         Reflect.getMetadata('isPublic', findById)   → undefined
  │         Reflect.getMetadata('isPublic', CoffeeController) → undefined
  │         header !== key → throw UnauthorizedException
  │                            │
  │                            └──► exception filter ──► 401 {"message":"Provide a valid API key",...}
  │
  ├─ (only if every guard returned true)
  ├─ pipes build the arguments      ValidationPipe / ParseIntPipe        → 400 on bad input
  ├─ handler                        coffee.controller.ts:46
  └─ interceptors' after part       transform.interceptor.ts            → response
```

And the labels themselves are not read per request from your source file — they were written once, when the class was defined at import time. At request time it is one `Map` lookup per target. The cost of the whole opt-out mechanism is two property reads.

## B5. Functional vs class

You can write both halves of this in plain functional JS, and it is worth seeing because the trade-off is not obvious.

**The guard as a higher-order function** — the same shape as Part A §5:

```js
const withApiKey = (handler) => (req, res) => {
  if (req.headers.authorization !== process.env.API_KEY) {
    return res.status(401).json({ message: 'Provide a valid API key' });
  }
  return handler(req, res);
};

app.post('/coffee', withApiKey(createCoffee));
app.get('/coffee', findAllCoffees);              // no wrapper = public
```

**The labels as a lookup table** — no decorators, no metadata:

```js
const routePolicy = {
  'GET /coffee':  { public: true },
  'GET /health':  { public: true },
};

const withApiKey = (handler) => (req, res) => {
  const policy = routePolicy[`${req.method} ${req.route.path}`] ?? {};
  if (policy.public) return handler(req, res);
  if (req.headers.authorization !== process.env.API_KEY) {
    return res.status(401).json({ message: 'Provide a valid API key' });
  }
  return handler(req, res);
};

app.use(withApiKey(router));                     // one wrap, applies to everything
```

Side by side:

| | Function + lookup table | Guard class + `@Public()` + `Reflector` |
|---|---|---|
| Where the rule lives | one function you can read top to bottom | a class the container builds, bound in a module you might not open |
| Where the exceptions live | **one table**: "which routes are public?" is one file | next to each route: the question needs a grep |
| Drift | the table is keyed by a path string; rename the route and the entry rots silently | the label is attached to the method, so it moves with it |
| Type safety | strings and objects, nothing checked | `@Public()` is a function; a typo is a compile error |
| Dependencies | close over whatever you like at the place you build it | asks the container (`ConfigService`, `Reflector`, a cache client) |
| Coverage of new routes | depends where you wrapped: `app.use(withApiKey(router))` covers everything, per-route wrapping doesn't | `APP_GUARD` covers everything including files added next year |
| Reuse across transports | welded to `(req, res)` | `ExecutionContext` means the same class works for WebSockets and microservices |
| Testing | call the function with a fake `req` | instantiate the class with a fake `Reflector`, build a fake `ExecutionContext` |

**What the class version buys:** the guard becomes genuinely generic. It never mentions a path, so a new controller is covered the moment it exists, and the fact that a route is public is stated in the file where that route is written, by the person writing it, in the review where it matters. That is the difference between a policy and a list someone has to maintain.

**What it costs:** you lose the single place to look. The functional table can answer "show me every public route" instantly; the decorator version cannot, which is a real audit problem the day someone asks. It also costs machinery: metadata, a container-built class, a module — vastly more moving parts than an object literal, for a behaviour that reads worse from the outside.

A senior takes both: the decorator approach for correctness, plus a startup check that walks the routes and logs the public ones, so the list exists somewhere a human can review (practice task 5).

## B6. In my project

Right now, **nothing is guarded**. Concretely:

- `src/main.ts:38` — `NestFactory.create(AppModule)`. There is **no `useGlobalGuards` call** in this file; the two global bindings that exist are the pipe at `src/main.ts:54` and the interceptor at `src/main.ts:69`.
- `src/app.module.ts:91` — `providers: [AppService]`. **No `APP_GUARD` entry**, and no `CommonModule` in the `imports` array at `src/app.module.ts:42`.
- `src/guards/guard-role.guard.ts:9` — `return true;`. This is the CLI stub generated on 18 September and never filled in. It is a guard that allows everything, it is bound to nothing, and its `_context` parameter is prefixed with an underscore precisely because nothing reads the context yet. Two things to notice: it sits in `src/guards/` rather than the `src/common/guards/` the course uses for things that belong to no feature, and its name (`GuardRoleGuard`) came out of a `nest g guard guard-role` typo. Both worth fixing when it becomes real.
- `src/coffee/coffee.controller.ts:39` — `@Get() findAll(...)`: the public menu. This is the route that gets `@Public()`.
- `src/coffee/coffee.controller.ts:57` — `@Post() create(...)`: the route the requirement is actually about.
- `src/coffee/coffee.controller.ts:45`, `:68`, `:76` — `findById`, `updateById`, `deleteById`. Write-protection has to cover the last two, which is three routes to remember with per-route binding and zero to remember with `APP_GUARD`.
- `src/app.controller.ts:44` — `@Get() getHello()`. This is the closest thing you have to a health check, and it is the route a global guard breaks first.
- `@nestjs/config` is **not in `package.json`** yet and nothing in `src/` imports `ConfigService`, so note 15 is written but not applied. Until it is, a guard here reads `process.env.API_KEY` with nothing validating it exists — the exact thing B3 step 7 warns about. Wiring `ConfigModule` is a prerequisite, not a polish step.

**Real output.** The app needs Postgres to boot, so the numbers in this part come from a scratch Nest app built from the same controller shapes and run on 2026-09-27, not from your app. Everything quoted in B3 was observed, including:

```
canActivate() returns false      -> 403 {"message":"Forbidden resource","error":"Forbidden","statusCode":403}
throw UnauthorizedException(msg) -> 401 {"message":"Provide a valid API key in the authorization header","error":"Unauthorized","statusCode":401}
@Public() route, no header       -> 200 ["latte"]
class-level @Public(), no header -> 200 {"status":"ok"}   (get(handler) was undefined; getAllAndOverride found it)
bad body + no key                -> 401  (guard first)
bad body + correct key           -> 400 {"message":["name must be a string"],"error":"Bad Request","statusCode":400}
new ApiKeyGuard() via useGlobalGuards -> 500, server log: TypeError: Cannot read properties of undefined (reading 'getAllAndOverride')
```

## B7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| Check the key inside each handler | Route number six forgets, silently, and works perfectly for everyone | whoever's data is behind route six |
| Protect with per-route `@UseGuards` only | Every new route is open until someone remembers; nothing fails when they don't | you, at the security review, or later |
| Bind auth globally with no opt-out | The health check returns 401, the load balancer pulls every instance, the site goes down looking like an infra fault | every user, and the on-call engineer |
| `return false` for a missing token | 403 "Forbidden resource": wrong code, no message. Clients try to refresh a token instead of logging in, and loop | the frontend, and you debugging their loop |
| `app.useGlobalGuards(new ApiKeyGuard())` when the guard injects anything | Every route 500s with `Cannot read properties of undefined` (verified above) | everyone, immediately — at least it fails closed |
| `reflector.get(KEY, context.getHandler())` only | A label put on the controller is invisible: `/health` stays 401 while `@Public()` sits three lines above it | you, staring at a decorator that "isn't working" |
| Write `'isPublic'` as a string in both files | A typo in either one is not an error anywhere; the guard reads `undefined` and denies a route you believe is open | the partner who gets 401 on your public menu |
| `@Public()` on a whole controller to fix one route | Every present and future method in that controller is open, including the `@Delete` someone adds next month | whoever's coffee gets deleted |
| Put a database query in the guard | It runs on every request, before caching, and its failure mode is "auth is down" | latency on every route, and the database at peak |
| `catch { return true }` inside a guard | The guard fails **open**: a config blip or a timeout means the whole API is unauthenticated, quietly | everyone, and nobody notices because there is no error |
| Use the guard to enforce a business rule ("no more than 10 coffees per brand") | The rule only exists for HTTP callers; a migration, a cron job or a seed script skips it | data integrity (same lesson as pipes, note 07 §6) |

## B8. 🧠 Senior engineer lens

- **"Deny by default, opt out explicitly" is the whole point, and it is a general rule.** It is the same reasoning as a firewall's default-deny, as `whitelist: true` on your `ValidationPipe`, and as TypeScript's `strict`. The question to ask about any safety mechanism is not "does it work when I use it" but "what happens when someone forgets". Design so that forgetting produces a 401, not a breach. Part A §8 makes the same argument from the binding side.
- **Metadata + a generic reader is a pattern, not a guard trick.** Once you can label a route and read the label at request time, you can build `@Roles('admin')`, `@SkipTransform()` for the PDF download that a global interceptor was mangling (note 06), `@CacheTTL(60)`, `@SkipThrottle()`, `@ApiKeyScope('write')`. Every one of those is a global block plus a per-route exception, and every one is `SetMetadata` + `Reflector`. The libraries you use (`@nestjs/throttler`, `@nestjs/cache-manager`, `@nestjs/swagger`) are built out of exactly this.
- **API keys are the weakest real authentication there is, and knowing why is part of knowing guards.** One shared secret, no expiry, no identity, no scopes, and it appears in logs and curl history. It is fine for server-to-server partner access with rotation and per-partner keys; it is not a login. A real auth guard verifies a signed token, extracts *who* the caller is, and attaches that to the request so later code can make per-user decisions. That is the next course, and the shape of the guard stays exactly what you built here.
- **Authentication and authorization are two different checks and want two different layers.** "Is this a valid key" is request-shaped and cheap: guard. "May *this* partner delete *this* coffee" needs the row and belongs where the row is loaded. Cramming both into a guard means a database query in the request's first millisecond and the same coffee fetched twice.
- **Consider the information you leak in the refusal.** Guards before pipes means an unauthenticated caller can't read your validation rules. Keep going in that direction: identical bodies for "no key" and "wrong key" (you can't tell one from the other above, deliberately), and no timing difference for a valid-format-but-wrong key. Constant-time comparison matters once the secret is per-user.
- **A global guard is a single point of failure with the blast radius of the whole app.** It is on the hot path of every request, so it must be fast, and it must never throw for reasons unrelated to auth. If it ever needs to call another service, you need a timeout and a decision written down in advance about what happens when that service is unreachable — and "fail closed" is usually right for auth even though it means an outage.
- **The audit question.** Six months in, someone will ask "which endpoints are reachable without a key?". With decorators, the answer is a grep, which is not an answer a security reviewer accepts. Print the list at startup, or assert it in a test that fails when a new public route appears. Making the safe thing checkable is what turns a pattern into a guarantee.

## B9. 🔗 Connects to

- **Part A of this note** — where guards sit among the four blocks, the measured execution order, and why `APP_GUARD` beats `useGlobalGuards`
- [05 — Exception filters](05-exception-filters.md) — what turns your `UnauthorizedException` into a 401 body, and `ArgumentsHost`, which `ExecutionContext` extends
- [06 — Interceptors](06-interceptors.md) §4.7 — `ExecutionContext`, `getHandler()`, `getClass()`; and practice task 4 there is `@SkipTransform()`, the same pattern for a different block
- [13 — Custom providers](13-custom-providers.md) — `{ provide: APP_GUARD, useClass: ... }` is an ordinary provider entry; `@Inject` and why `new` breaks injection
- [03 — Modules, controllers, providers, DI](03-modules-controllers-providers-di.md) — decorators as sticky labels, and `Reflect.defineMetadata`
- [15 — Configuration](15-configuration.md) — where the API key should come from, and why the app should refuse to start without it
- [07 — Pipes & validation](07-pipes-validation.md) — the block that runs *after* the guard, and why that order protects you
- **Often confused with:** middleware (runs earlier, knows nothing about which handler is coming, so it can't read route labels) and interceptors (run around the handler; a guard only decides whether to start)
- **Next:** course videos 56–57 (interceptor pointcuts, timeouts), then the Auth course extension, where this guard becomes a token guard with a real user on the request

## B10. ✍️ In my own words

> _(mine to write)_

## B11. 🛠️ Practice

1. **Build it for real, in the order the requirement implies.** Wire `ConfigModule` first (note 15), then `src/common/guards/api-key.guard.ts`, then `@Public()` on `src/coffee/coffee.controller.ts:39` and on `src/app.controller.ts:44`, then the `APP_GUARD` binding in a new `CommonModule`. Verify with four curls: public route with no key, `POST /coffee` with no key, `POST /coffee` with the key, and `GET /` with no key.

   <details><summary>Hints</summary>

   - Generate the pieces rather than hand-writing the boilerplate: `nest g guard common/guards/api-key`, `nest g mo common`. Check afterwards that the CLI didn't also add the guard to a `providers` array you didn't want.
   - ⚠️ Run these **inside `nestjsmasterycourse/`** — the guard folder has ended up in the parent directory before.
   - `CommonModule` must `imports: [ConfigModule]` for `ConfigService` to be resolvable inside the guard, and `AppModule` must import `CommonModule` or the `APP_GUARD` provider is never registered. Two separate mistakes with the same symptom: nothing is guarded at all.
   - Bind the guard **before** you add any `@Public()`. Seeing your own app return 401 on `GET /` is the point of the exercise.
   </details>

2. **Both refusals, measured by you.** Make the guard `return false`, note the status and body. Then `throw new ForbiddenException('nope')`, then `throw new UnauthorizedException('nope')`. Write the three bodies into `notes/mistakes-and-aha.md` and decide which your frontend would handle correctly.

   <details><summary>Hints</summary>

   - `curl -i` so you see the status line, not only the body.
   - Ask yourself what a React app with an axios interceptor that refreshes tokens on 401 does with each of the three.
   </details>

3. **Break the lookup on purpose.** Get `@Public()` working on `findAll`, then change the guard to `this.reflector.get<boolean>(IS_PUBLIC_KEY, context.getHandler())` and move the `@Public()` up onto `@Controller('coffee')`. Predict the result before you run it, then fix it with `getAllAndOverride` and both targets.

   <details><summary>Hints</summary>

   - Log both lookups on every request while you do this; the pair of values is the lesson.
   - Then try the reverse order, `[context.getClass(), context.getHandler()]`, with a label on both, and work out from the loop in B4 which one wins and why that's the wrong order.
   </details>

4. **Prove the ordering yourself.** With the guard bound globally, send `POST /coffee` with `{"name": 42, "hacker": true}` and no key. Then the same body with the key. Explain in one sentence why the first response is the safer one.

   <details><summary>Hints</summary>

   - Your `ValidationPipe` has `forbidNonWhitelisted: true` (`src/main.ts:57`), so the second response names the offending field. Ask whether you'd want a stranger to see that.
   </details>

5. **Answer the audit question.** At startup, log every route that is reachable without a key. Then make it a test that fails if a new public route appears.

   <details><summary>Hints</summary>

   - You already saw where the labels live: B4 showed `Reflect.getOwnMetadataKeys(CoffeeController.prototype.findAll)` returning `[ 'isPublic', 'path', 'method' ]`.
   - So walk the controllers, walk each prototype's own method names, and read the same three keys. `DiscoveryService` from `@nestjs/core` will hand you the controllers without you listing them by hand.
   - A snapshot test (compare the printed list to a committed file) fails loudly on a new public route, which is the behaviour you want in review.
   </details>

6. **A second label, for a different block.** Add `@SkipTransform()` and make `src/utils/transform.interceptor.ts` respect it (note 06 practice 4). Notice what you have to change in `main.ts` for the interceptor to be able to read metadata at all.

   <details><summary>Hints</summary>

   - The interceptor currently gets built with `new` at `src/main.ts:69`. `Reflector` cannot arrive that way.
   </details>

7. **Go past the course: a rate-limit guard.** Deny more than five requests per minute from the same IP, with a `@SkipThrottle()` opt-out. Where does the counter live, and what happens to it when you run two copies of the app?

   <details><summary>Hints</summary>

   - A field on the guard is per-process memory, and the guard is a singleton (note 04's shared-state discussion).
   - The right status code here is 429, and there is a header clients expect with it. Look up `Retry-After`.
   - Then read what `@nestjs/throttler` does instead, and why it wants Redis.
   </details>

## B12. ❓ Quiz

**Q1.** Your guard decides the caller has no valid key. Version A does `return false`; version B does `throw new UnauthorizedException('Provide a valid API key')`. What does the client actually receive in each case, and which is right for a missing key?

- A) Both return 401; the message differs
- B) A returns `403 {"message":"Forbidden resource","error":"Forbidden","statusCode":403}` — Nest throws `ForbiddenException` for you, with a fixed message. B returns `401` with your message. A missing key is 401, so B is right
- C) A returns 400 because the request was malformed
- D) A returns 500, because a guard must never return false

<details><summary>Answer</summary>

**B**, measured on 2026-09-27: `return false` gave exactly `403 {"message":"Forbidden resource","error":"Forbidden","statusCode":403}`, and the throwing version gave `401 {"message":"Provide a valid API key in the authorization header","error":"Unauthorized","statusCode":401}`.

Why it matters beyond aesthetics: 401 means "I don't know who you are" and 403 means "I know, and you may not". A frontend with a token-refresh interceptor reacts to 401 by refreshing and retrying, and to 403 by showing a permission error. Send 403 for a missing key and clients take the wrong branch forever. Throwing also routes through your exception filters (note 05), so the error comes out in the same shape as the rest of your API.

</details>

**Q2.** A teammate adds `{ provide: APP_GUARD, useClass: ApiKeyGuard }` and ships it. No `@Public()` anywhere yet. Monitoring goes red within a minute and the site is unreachable, even though the guard's logic is correct. What happened, and what is the *ordering* lesson for doing this safely?

- A) The guard is buggy; roll it back and bind it per route instead
- B) `APP_GUARD` covers every route, so `GET /` (the health check, `src/app.controller.ts:44`) returns 401. The load balancer sees every instance as unhealthy and removes them all, so the outage is total and looks like infrastructure. The lesson: add the opt-out labels *and* verify the health and login routes **before** the global binding goes live — or ship the binding and the labels in the same commit
- C) Global guards don't work with GET requests
- D) Health checks bypass guards automatically

<details><summary>Answer</summary>

**B.** Measured: with the guard bound globally and no labels, `GET /coffee` and `GET /` both returned 401.

**A is the tempting wrong answer** and worth arguing with. Per-route binding fails open: every route added afterwards is unprotected until someone remembers a decorator, and nothing breaks when they forget, so nobody finds out. Global-plus-opt-out fails closed: the worst outcome of forgetting a label is a 401 on a route that should be open, which you notice in the first minute (as this team did). Part A §8 makes the same argument. Keep the global binding; fix the ordering of the rollout.

</details>

**Q3.** `@Public()` is on the `HealthController` **class**, not on its method. The guard does `this.reflector.get<boolean>(IS_PUBLIC_KEY, context.getHandler())`. What happens, and why does the fix need both targets in a specific order?

- A) It works: metadata is inherited from the class by its methods
- B) The lookup returns `undefined` and the health check gets 401. `Reflect.getMetadata` reads the label off the exact object you pass, and the label was written onto the class, not onto the method function. `getAllAndOverride(KEY, [getHandler(), getClass()])` loops the array and returns the first value that isn't `undefined`, so handler-first means a method-level label overrides a class-level one — the order you want
- C) It throws, because `getHandler()` is undefined for class-level metadata
- D) It works, but only for GET routes

<details><summary>Answer</summary>

**B**, and this is measured, not argued. The guard logged both lookups for the same request:

```
[guard] Health3.ping   getAllAndOverride=true   get(handler)=undefined
GET /health -> 200 {"status":"ok"}
```

`get(handler)` was `undefined` while the label sat on the controller three lines above. The real `Reflector.get` is one line — `Reflect.getMetadata(key, target)` — and metadata is stored per object: `@Public()` on a method writes to `Controller.prototype.method`, on a class it writes to `Controller`. Nothing inherits. Reversing the array to `[getClass(), getHandler()]` would let a class-level `true` win over a method-level label, which silently opens methods you meant to protect.

</details>

**Q4.** A global `ApiKeyGuard` and a global `ValidationPipe({ forbidNonWhitelisted: true })` are both bound. A stranger sends `POST /coffee` with `{"name": 42, "hacker": true}` and no key. What comes back, and what is the security argument for it?

- A) `400` listing `name must be a string` and `property hacker should not exist`, because the body is parsed first
- B) `401` with the auth message and nothing about the body. Guards run before pipes, so an unauthenticated caller learns nothing about your DTOs — no field names, no rules — and you spend no validation CPU on unauthenticated traffic
- C) Both errors, merged into one response
- D) It depends which decorator is written higher above the handler

<details><summary>Answer</summary>

**B.** Measured pair, same app, same minute:

```
POST /coffee {"name":42,"hacker":true}  no key      -> 401 {"message":"Provide a valid API key...","error":"Unauthorized","statusCode":401}
POST /coffee {"name":42}                correct key -> 400 {"message":["name must be a string"],"error":"Bad Request","statusCode":400}
```

**D is a common belief and wrong** — Part A's measured order shows guards always run before pipes regardless of the order you typed the decorators in. The leak in A is real, by the way: `forbidNonWhitelisted` names the rejected field, which tells an attacker your schema one guess at a time.

</details>

**Q5.** You move the working guard's binding from `APP_GUARD` back to `app.useGlobalGuards(new ApiKeyGuard())` in `main.ts`, because it looks tidier. TypeScript complains about a missing argument and you silence it. What do users see?

- A) It works; `@Injectable()` means Nest injects `Reflector` whenever the class is used
- B) Every route returns `500 {"statusCode":500,"message":"Internal server error"}`, and the log says `TypeError: Cannot read properties of undefined (reading 'getAllAndOverride')`. You called `new` yourself, so nothing filled the constructor and `this.reflector` is `undefined`. At least it fails closed
- C) Only the `@Public()` routes break
- D) The app refuses to start

<details><summary>Answer</summary>

**B**, verified — that TypeError and stack came out of `GuardsConsumer.tryActivate` on the first request.

Two things to take from it. First, the rule from note 13 in its bluntest form: **whoever calls `new` provides the arguments**, and `main.ts` has no container to ask. `APP_GUARD` (or `APP_PIPE`/`APP_INTERCEPTOR`/`APP_FILTER`) exists for precisely this. Second, **D is wrong and that's the interesting part**: the app boots fine. The failure waits for the first request, so this survives a "does it start?" smoke test and dies in front of users.

</details>

**Q6.** New requirement: *"a partner may only update or delete the coffees their own account created."* Your `ApiKeyGuard` is already global. What's the right place for this rule?

- A) Extend `ApiKeyGuard`: load the coffee by `context.switchToHttp().getRequest().params.id` and compare owners
- B) A pipe on the `id` parameter, since the check is about that argument
- C) Mostly in the service, next to where the coffee is already loaded. A guard would have to query the database on the request's first millisecond, before any caching, and the service loads the same row again straight afterwards — two queries and one rule split across two files. Guards are for cheap, request-shaped decisions
- D) A global interceptor, because it runs around the handler

<details><summary>Answer</summary>

**C**, and this is the authentication/authorization split. "Is this key valid" is answerable from the request alone: guard. "Does this row belong to this caller" needs the row, and the service is already fetching it — so put it where the data is and throw `ForbiddenException` from there (403 is right here: you know who they are, and they may not).

**B is wrong for a further reason worth naming**: pipes see one argument in isolation, and a rule enforced in a pipe exists only for HTTP callers — a migration or a cron job walks straight past it (note 07 §6). **A** is the answer most people give, and it's the one that shows up in a profiler six months later as a duplicate query on every write.

</details>
