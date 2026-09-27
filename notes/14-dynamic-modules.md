# 14 — Dynamic modules & provider scopes

> 📍 **Where on the Big Map:** SERVER START, before any request. This is how `TypeOrmModule.forRoot({...})` in `src/app.module.ts` works.
> 📘 **Course:** Part A = video 41 (Create a Dynamic Module) · Part B = videos 42–43 (Control Providers Scope, Request-scoped providers)
> 🌿 **Branch:** `dependency-injection`
> Builds on [13 — Custom providers](13-custom-providers.md).

---

# Part A — Dynamic modules: a module you can pass settings to

## 1. The problem

Every module you've written so far is a fixed list. You write it once, and it is what it is:

```ts
@Module({
  providers: [CoffeeService],
  controllers: [CoffeeController],
})
export class CoffeeModule {}
```

That's fine for a module about *your* coffees. Now try to write a module that's meant to be **reused**: a database module, say, that opens a connection.

```ts
@Module({
  providers: [{
    provide: 'CONNECTION',
    useValue: new DataSource({
      type: 'postgres',
      host: 'localhost',        // ← hard-coded
      port: 5432,               // ← hard-coded
      password: 'pass123',      // ← hard-coded
    }),
  }],
})
export class DatabaseModule {}
```

It works, exactly once, for one app, on one machine. The moment a second app wants it on a different port, or you want a different database in tests, there's nothing you can do from the outside. `imports: [DatabaseModule]` takes no arguments. The settings are baked in, and the only way to change them is to edit the module.

You've felt the other side of this already. When you wrote:

```ts
TypeOrmModule.forRoot({ type: 'postgres', host: 'localhost', password: 'pass123', ... })
```

you passed *your* settings into somebody else's module. The Nest team never knew your password. This note is how they did that, so you can do it too.

## 2. Mental model

A normal module is an **object literal**: written out, fixed.

```js
const databaseModule = { providers: [connectionMadeWithHardCodedSettings] };
```

A dynamic module is a **factory function that returns that object**:

```js
const makeDatabaseModule = (options) => ({ providers: [makeConnection(options)] });

makeDatabaseModule({ host: 'localhost' });      // one app
makeDatabaseModule({ host: 'test-db', port: 5433 });  // another
```

That's the whole idea, and you've been writing factory functions for years. `TypeOrmModule.forRoot(options)` is `makeDatabaseModule(options)`. It runs at startup, on the line where you call it, and returns a module description for Nest to use.

## 3. Baby steps

### Step 1 — Naive: hard-code the settings

The `DatabaseModule` in section 1. What breaks: it can't be reused, can't be pointed at a test database, and the password is now inside a module that might be shared with other projects.

### Step 2 — First attempt: let the app set a global before importing

The instinct is to put the settings somewhere the module can read:

```ts
// somewhere in main.ts, before anything else
global.DB_OPTIONS = { host: 'localhost', port: 5432 };

// database.module.ts
useValue: new DataSource(global.DB_OPTIONS)
```

It "works". What's wrong: the module's needs are now invisible (nothing in `imports: [DatabaseModule]` tells you settings are required), the order matters in a way nobody can see, two different configurations in one app are impossible, and TypeScript can't tell you which options exist. This is the implicit-dependency trap from note 13 §7, one level up.

### Step 3 — Make it a function: the module returns its own description

Instead of the decorator being the whole story, add a **static method** that takes options and returns the module's description, with the options baked into the providers:

```ts
// src/database/database.module.ts
import { DynamicModule, Module } from '@nestjs/common';
import { DataSource, DataSourceOptions } from 'typeorm';

@Module({})                                     // empty: the real content comes from register()
export class DatabaseModule {
  static register(options: DataSourceOptions): DynamicModule {
    return {
      module: DatabaseModule,                   // "the returned description belongs to this module"
      providers: [
        {
          provide: 'CONNECTION',
          useFactory: async () => new DataSource(options).initialize(),   // options from the caller
        },
      ],
      exports: ['CONNECTION'],
    };
  }
}
```

And the app calls it like a function, because it is one:

```ts
@Module({
  imports: [
    DatabaseModule.register({ type: 'postgres', host: 'localhost', port: 5432, password: 'pass123' }),
  ],
})
export class AppModule {}
```

Read the returned object: it's the same `@Module({...})` shape you already know (`providers`, `exports`, `imports`, `controllers`), plus one extra key, `module`, saying which class it belongs to. Nothing new has been introduced. You have written a function that returns a module description, and Nest calls it a **dynamic module**.

The `DataSourceOptions` type is doing real work here: the caller gets autocomplete for every setting and a compile error for a typo, instead of discovering it at startup.

### Step 4 — What's still wrong: where do the settings come from?

Look at what we just wrote in `AppModule`: the password is now hard-coded *there* instead of in the database module. Better (the module is reusable), but the secret is still in code.

What you actually want is "read the settings from the environment, check them, then configure the module with them". The settings now come from **another provider** (a config service), and that provider has to be built first. So the options can't be a plain object any more; they have to come from a factory:

```ts
imports: [
  DatabaseModule.registerAsync({
    inject: [ConfigService],                              // build this first
    useFactory: (config: ConfigService) => ({             // then call me with it
      type: 'postgres',
      host: config.get('DB_HOST'),
      port: config.get('DB_PORT'),
      password: config.get('DB_PASSWORD'),
    }),
  }),
],
```

That's the same `useFactory` + `inject` pair from note 13 step 7, used to build *options* rather than a value. The `Async` in the name means "the options come from somewhere that itself has to be built, and may take time" (note 13 step 7b).

You'll meet this shape constantly: `ConfigModule.forRootAsync`, `JwtModule.registerAsync`, `TypeOrmModule.forRootAsync`. Course 4 has a builder (`ConfigurableModuleBuilder`) that writes this boilerplate for you.

### Step 5 — What a senior does: naming and counting

Two conventions, because the names are not decoration:

| Name | Means | Call it |
|---|---|---|
| `forRoot(options)` | configure this module **once for the whole app** | once, in `AppModule` |
| `forFeature(...)` | give **this one module** its slice, using the already-configured root | in each feature module |
| `register(options)` | configure it **per use**; two callers may pass different options | wherever needed |
| `…Async(...)` | same, but the options come from a factory that may inject and await | as above |

The counting part matters more than the naming. **Every call runs the function again and returns a new description with new providers.** Call `forRoot` in two modules and you get two connections, two pools, two of whatever is expensive. That's why the pattern is "root once, feature many times": `forFeature` doesn't create a connection, it only asks the existing one for repositories (note 09 §3.1b).

And the senior habit around secrets: a reusable module should take its settings, never read `process.env` itself. Then the same module works in your app, in tests, and in someone else's project, and the "where do secrets come from" decision lives in one place (note 15).

## 4. How it works underneath

An `@Module({...})` decorator writes its four keys onto the class as labels (note 03 §4). A dynamic module skips the decorator and hands Nest the same four keys **as a returned object**, at startup:

```js
// roughly what Nest does when it walks your imports array
function readModule(entry) {
  if (typeof entry === 'function') {              // a class: DatabaseModule
    return { module: entry, ...readLabels(entry) };        // read the @Module() labels
  }
  return entry;                                   // already an object: { module, providers, exports, imports }
}
```

That's the entire mechanism. `imports` accepts either a class (read its labels) or an object (use it directly). A static method is just a convenient place to build that object.

**Proof from this repo** (printed in note 09 §3.1b):

```
TypeOrmModule.forRoot({...})        → { module: TypeOrmModule, imports: [ TypeOrmCoreModule ] }
TypeOrmModule.forFeature([Coffee])  → { module: TypeOrmModule,
                                        providers: [ { provide: 'CoffeeRepository', inject: ['DataSource'] } ],
                                        exports: [...] }
```

Ordinary objects, with the keys you already know.

The flow, file by file:

```
 src/main.ts:38           NestFactory.create(AppModule)
   │
   ▼ src/app.module.ts:57  TypeOrmModule.forRoot({...})   ← this FUNCTION RUNS HERE, at startup
   │                        returns { module, imports: [TypeOrmCoreModule] }
   ▼                        TypeOrmCoreModule holds a useFactory that opens the connection…
   │                        …and it is async, so Nest waits (note 13 step 7b)
   ▼ src/coffee/coffee.module.ts:23   TypeOrmModule.forFeature([Coffee, Flavor])
   │                        returns providers for 'CoffeeRepository' and 'FlavorRepository',
   │                        each a useFactory that asks the already-built DataSource
   ▼
   everything registered → routes bound → app.listen()
```

One more key a dynamic module may return: `global: true`, which makes its exports available everywhere without importing it. `TypeOrmCoreModule` uses this, which is why any module can get repositories without importing anything extra. Use it sparingly in your own modules: it hides where things come from.

## 5. Functional vs class

```js
// functional: a function that returns a description
const makeDatabaseModule = (options) => ({
  providers: [{ provide: 'CONNECTION', useFactory: () => connect(options) }],
  exports: ['CONNECTION'],
});
```

```ts
// Nest: the same function, living on the class as a static method
@Module({})
export class DatabaseModule {
  static register(options: DataSourceOptions): DynamicModule {
    return { module: DatabaseModule, providers: [...], exports: ['CONNECTION'] };
  }
}
```

**What the class version buys:** the function has a home. Callers write `DatabaseModule.register(...)`, so the module and its configuration API are one importable thing, and the `DynamicModule` return type makes the shape checkable. `static` means the method belongs to the class itself, not to an instance: nobody ever writes `new DatabaseModule()`.

**What it costs:** an empty `@Module({})` decorator that looks pointless until you know the real content arrives at runtime, and a convention (`forRoot` / `register` / `…Async`) you have to learn, because the names carry meaning the compiler doesn't check.

## 6. In my project

- `src/app.module.ts:57` — `TypeOrmModule.forRoot({...})`: a dynamic module call. The settings you pass are how the Nest team's module learned about *your* database.
- `src/coffee/coffee.module.ts:23` — `TypeOrmModule.forFeature([Coffee, Flavor])`: the per-feature form, called once per module that needs tables.
- Note 09 §3.1b has the real printed output of both calls.
- Nothing hand-written yet. `DatabaseModule.register()` from video 41 is the practice below.

⚠️ **The video's code won't compile in this project.** It uses `createConnection()` and the `ConnectionOptions` type from TypeORM. I checked this repo's TypeORM (1.1.1): `createConnection`, `Connection` and `ConnectionOptions` are **not exported any more**. The current equivalents are `new DataSource(options).initialize()` and the type `DataSourceOptions`. Same idea, renamed.

## 7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| Call `forRoot()` in more than one module | Two connections, two pools, double the resources; "why do we have 20 connections?" | whoever debugs the connection limit in production |
| Hard-code settings inside a reusable module | It can't be reused, and secrets end up in shared code and in git history | the next team, and security |
| Read `process.env` inside a library module instead of taking options | The module works only where those exact variable names exist; tests can't reconfigure it | whoever tries to use it anywhere else |
| Forget `module: X` in the returned object | Nest can't tell whose description this is; startup error | you, at startup |
| Return `providers` but forget `exports` | The module builds things nobody outside can inject: "can't resolve dependencies" (note 13 step 8) | you, at startup |
| Mark every dynamic module `global: true` | Imports stop telling you what depends on what; a module can silently rely on something nobody imported | whoever refactors later |
| Do slow work at the top of `register()` instead of inside a factory | It runs while the module list is being read, before Nest can await it properly | startup time, every deploy |
| Pass a mutable options object and change it later | Providers captured the original; the change appears to do nothing | whoever spends an afternoon on it |

## 8. 🧠 Senior engineer lens

- **This is how libraries stay libraries.** The rule is: a reusable module takes its configuration and knows nothing about where it came from. Your app decides that `DB_HOST` is an environment variable; the database module never finds out.
- **Configuration is a dependency like any other.** `registerAsync` is not a special feature; it's `useFactory` + `inject` applied to options. Once you see that, `JwtModule.registerAsync`, `ConfigModule.forRootAsync` and the rest stop being separate things to memorise.
- **Expensive things are created per call.** Connections, pools and clients are why the root/feature split exists. When you write your own module, ask: "if someone calls this twice, what gets created twice?"
- **Fail at startup.** Validate the options at the top of `register()`, and throw with a clear message. A module that boots with a missing password and dies on the first request costs far more to diagnose.
- **Typed options are documentation that can't rot.** `DataSourceOptions` tells the caller everything they may pass. A `Record<string, any>` tells them nothing and turns typos into runtime mysteries.
- Course 4 (Advanced Concepts) has `ConfigurableModuleBuilder`, which generates the `register`/`registerAsync` pair for you. Worth knowing it exists; not worth reaching for until you've written the pair by hand once.

## 9. 🔗 Connects to
- [13 — Custom providers](13-custom-providers.md): `useFactory`, `inject`, async factories, tokens. A dynamic module is those pieces with settings passed in.
- [03 — Modules, Controllers, Providers & DI](03-modules-controllers-providers-di.md): the four keys a module description holds
- [09 — Database, Docker & TypeORM](09-database-docker-typeorm.md) §3.1b: `forRoot`/`forFeature` printed as real objects
- 15 — Configuration: where the options should come from
- Part B below: provider scopes

## 10. ✍️ In my own words
> _(mine to write)_

## 11. 🛠️ Practice

1. **Build it.** `nest g mo database`, then write `DatabaseModule.register(options)` returning a `DynamicModule` with a `'CONNECTION'` provider (use `new DataSource(options).initialize()`, not the video's `createConnection`). Import it in `AppModule` with your real settings. Inject `'CONNECTION'` somewhere and log it.
2. **Break it deliberately.** Remove `module: DatabaseModule` from the returned object. Read the error. Then remove `exports` instead and read that one.
3. **Prove "per call".** Import `DatabaseModule.register(...)` in two different modules with a `console.log` inside the factory. How many times does it print? Now you know what `forRoot`-once means.
4. **Make it async.** Add `registerAsync({ inject: [...], useFactory: ... })` that builds the options from something else, and confirm the connection opens before the app starts listening.
5. **Read the real thing.** Open `node_modules/@nestjs/typeorm/dist/typeorm.module.js` and find `forRoot` and `forFeature`. You've now written the same shape by hand, so it should read as familiar rather than magic.

<details><summary>Hints</summary>

- 1: the decorator stays `@Module({})`, empty. Everything comes from the static method's return value.
- 2: without `module`, Nest doesn't know which class the description belongs to and says so at startup.
- 4: the options factory is the same `{ inject, useFactory }` pair as note 13 step 7; it just returns an options object instead of a service.

</details>

## 12. ❓ Quiz

**Q1.** What is a dynamic module, in one sentence, without using the words "dynamic" or "module"?

- A) A class with extra decorators
- B) A function that runs at startup and returns the same description a `@Module({...})` decorator would have written, with the caller's settings baked into it
- C) A module that can change while the app is running
- D) A module loaded only when first used

<details><summary>Answer</summary>

**B.** "Dynamic" only means the description is built by a function at startup instead of written out. **D** is lazy-loading, a different feature (course 4, video 5).

</details>

**Q2.** `DatabaseModule.register({...})` is imported in `AppModule` and again in `CoffeeModule`, and its factory opens a connection. How many connections?

- A) One; Nest caches by module class
- B) Two; each call runs the function again and returns a fresh set of providers
- C) Startup error: duplicate module
- D) Depends on `global: true`

<details><summary>Answer</summary>

**B.** This is exactly why the convention exists: `forRoot` once in `AppModule` for the expensive thing, `forFeature` in each module for the cheap per-feature pieces (note 09 §3.1b).

</details>

**Q3.** A teammate writes a reusable `MailerModule` that reads `process.env.SMTP_HOST` inside itself instead of taking options. What's the strongest objection?

- A) `process.env` is slow
- B) The module now only works where that exact variable name exists: it can't be configured per use, tests can't point it somewhere else, and its requirements are invisible at the import site
- C) It won't compile
- D) Environment variables are insecure

<details><summary>Answer</summary>

**B.** A reusable module takes settings; the app decides where settings come from. Same reasoning as "don't store request data on a service" (note 04): hidden inputs are the problem.

</details>

**Q4.** Why does `registerAsync` exist when `register` already takes an options object?

- A) It makes the module load faster
- B) Because the options themselves may have to be built first, by something that must be injected and possibly awaited (a config service reading and validating the environment)
- C) It registers the module in the background
- D) It's an older API kept for compatibility

<details><summary>Answer</summary>

**B.** It's `useFactory` + `inject` (note 13 step 7) applied to the options, and if the factory is async Nest waits before building anything that depends on it (step 7b).

</details>

**Q5.** You follow video 41 exactly and write `useValue: createConnection(options)` with `ConnectionOptions` as the type. What happens in this project, and why?

- A) It works
- B) It fails: this repo's TypeORM no longer exports `createConnection`, `Connection` or `ConnectionOptions`. The current API is `new DataSource(options).initialize()` and the type `DataSourceOptions`
- C) It works but opens two connections
- D) It only fails at request time

<details><summary>Answer</summary>

**B.** Verified against `node_modules/typeorm` in this repo. The idea in the video is unchanged; the names moved. This is normal with courses: learn the shape, check the current API.

</details>

---

# Part B — Provider scopes: how often does Nest build this thing?

> 📘 **Course:** video 42 (Control Providers Scope) · video 43 (Diving Into Request-Scoped Providers)

## 1. The problem

Note 04 ended with a rule: **never store per-request data on a service**, because one object serves every request and the data leaks between people. The example there was a service trying to remember "who is asking":

```ts
@Injectable()
export class OrderService {
  private currentUserId: number;          // ❌ one object, every request writes here
}
```

The fix was to pass identity as a parameter. But it's fair to ask the obvious follow-up: **why can't Nest just build a fresh service for each request?** Then each request would have its own `currentUserId` and the leak would be impossible.

It can. That's what this part is about, and the interesting bit is why it still isn't the answer most of the time.

## 2. Mental model

Three different answers to "how often do I build this?":

```
 singleton   ─ one for the whole app  ─ built at startup     ─ everyone shares it
 transient   ─ one per asker          ─ built at startup     ─ two classes asking = two objects
 request     ─ one per HTTP request   ─ built when it arrives ─ thrown away when the response is sent
```

The kitchen version: one chef for the restaurant; one chef per waiter; or a new chef hired for every customer and sent home after.

## 3. Baby steps

### Step 1 — The default you've been using: singleton

```ts
@Injectable()                                    // same as @Injectable({ scope: Scope.DEFAULT })
export class CoffeeService {}
```

Built once, at startup, before any request. Everyone who asks gets the same object. Put a `console.log('CoffeeService instantiated')` in the constructor and it prints **once**, while the app boots, no matter how many requests arrive afterwards. That's exactly what note 04's `requestCount` experiment showed.

Why this is safe in Node when it isn't in some other languages: your JavaScript runs on **one thread**, one piece at a time (note 04 §3.2). There's no second thread modifying the same object mid-statement. The danger isn't simultaneous access, it's the `await` gap.

### Step 2 — A new one for each asker: transient

```ts
@Injectable({ scope: Scope.TRANSIENT })
export class CoffeeService {}
```

Now every class that injects it gets **its own copy**. In the course's app, `CoffeesService` is injected in two places (the controller and a factory), so `CoffeesService instantiated` prints **twice** at startup. Remove the scope line and it prints once again.

Where this is actually useful: a logger that should know who it belongs to. Each consumer gets its own instance, which can carry that consumer's name in every log line. Not useful for anything holding shared state, since there is no longer one shared thing.

Custom providers take the same option:

```ts
{ provide: COFFEE_BRANDS, useFactory: () => [...], scope: Scope.TRANSIENT }
```

### Step 3 — A new one for each request

```ts
@Injectable({ scope: Scope.REQUEST })
export class CoffeeService {}
```

Two things change, and the second one surprises everybody.

**First:** nothing is built at startup. The log stays silent until a request arrives. Send three `GET /coffee` requests and `CoffeeService instantiated` prints **three times**, one per request. Afterwards each instance is thrown away (garbage collected).

**Second: the scope spreads upward.** `CoffeeController` is still a plain `@Controller()` with no scope setting, but it *depends* on a request-scoped service. Nest can't hand a fresh service to an object that was built once at startup, so the controller has to be rebuilt per request too. Add a `console.log` to the controller's constructor as well, send three requests, and you get **six** lines: three service, three controller.

```
 CoffeeController  (no scope set)   ─ depends on ─►  CoffeeService  (REQUEST)
        ▲                                                   │
        └────── becomes request-scoped too, automatically ──┘
```

That's the part to remember: **scope bubbles up the chain**. Mark one small service request-scoped and everything that depends on it, directly or indirectly, becomes request-scoped as well. A whole branch of your app switches from "built once" to "rebuilt on every request", and nothing in those files says so.

### Step 4 — What request scope buys: the request object itself

A request-scoped provider can ask for the request it belongs to:

```ts
import { REQUEST } from '@nestjs/core';

@Injectable({ scope: Scope.REQUEST })
export class AuditService {
  constructor(@Inject(REQUEST) private readonly request: Request) {}

  log(action: string) {
    console.log(action, this.request.headers['x-request-id'], this.request.ip);
  }
}
```

Now something deep in your call chain can see headers, cookies or the caller's IP without every method in between passing them down. That's the real reason this feature exists: per-request context, like a request id for tracing or the current tenant, that would otherwise have to be threaded through ten function signatures.

### Step 5 — What a senior does

Start from the cost. Request scope means Nest rebuilds that provider **and everything above it** on every single request. Nest caches what it can, but the object graph still gets constructed per request: more work per request, more garbage collection, slower average response, and a startup-time guarantee you no longer have (a provider that would have failed at boot now fails on a request).

So the order of preference:

1. **Pass the value as a parameter.** `getMyOrders(userId)` needs no scopes at all. Almost every "I need per-request data" case is this one (note 04 §3.3).
2. **Read it from the request in the controller** and hand it down. The controller already has the request; a custom decorator (`@ActiveUser()`, course 2) makes it one word.
3. **Request scope**, only when the value is needed deep in a chain you don't control, and threading it through would touch every signature: request-id logging, multi-tenant database selection.
4. If you do need it widely, **durable providers** (course 4, videos 15–18) keep one instance per tenant rather than one per request, which recovers most of the cost.

The course says the same thing in one sentence: *unless a provider must be request-scoped, use the default singleton whenever possible.*

## 4. How it works underneath

Roughly what changes in the container (note 13 §4) per scope:

```js
function resolve(name, book, request) {
  const entry = book.get(name);

  if (entry.scope === 'DEFAULT') {                 // built once, kept forever
    if (appCache.has(name)) return appCache.get(name);
    const thing = build(entry);
    appCache.set(name, thing);
    return thing;
  }

  if (entry.scope === 'TRANSIENT') {               // no cache: a new one every time it's asked for
    return build(entry);
  }

  if (entry.scope === 'REQUEST') {                 // one cache per request, thrown away after
    if (!request.cache) request.cache = new Map();
    if (request.cache.has(name)) return request.cache.get(name);
    const thing = build(entry, { REQUEST: request });   // this is how @Inject(REQUEST) works
    request.cache.set(name, thing);
    return thing;
  }
}
```

And the bubbling falls out of that: if `build(CoffeeController)` needs `resolve(CoffeeService)` and that resolve needs a `request`, then `CoffeeController` itself can only be built when a request exists. It cannot live in the app-wide cache.

Per request, the flow becomes:

```
 request arrives
   ├─ Nest makes a small per-request cache
   ├─ builds CoffeeService (REQUEST)        ← console.log fires
   ├─ builds CoffeeController (bubbled)     ← console.log fires
   ├─ runs the handler
   └─ response sent → cache dropped → both objects garbage collected
```

Compare with singleton, where those two build steps happened once, weeks ago, when the app started.

## 5. Functional vs class

You already know all three lifetimes from functional code; they're just where you call the factory:

```js
// singleton: built once, at module load, shared by everything that imports it
const coffeeService = makeCoffeeService(db);

// transient: each caller builds its own
const serviceForController = makeCoffeeService(db);
const serviceForFactory    = makeCoffeeService(db);

// request-scoped: built inside the handler, dies when the handler returns
app.get('/coffee', (req, res) => {
  const service = makeCoffeeService(db, req);      // a closure over THIS request
  res.json(service.findAll());
});
```

That last one is the shape you'd have written naturally in Express, and it's worth noticing: **the functional version makes the cost obvious** (you can see the object being built inside the handler), while `@Injectable({ scope: Scope.REQUEST })` hides it behind one word in a file you might never open again.

What the class version buys: the choice is declared in one place and everything above it adapts automatically, including code you didn't write. What it costs: exactly that invisibility. Nothing in `CoffeeController` says "I am rebuilt per request now".

## 6. In my project

Everything here is singleton today, which is why:

- `src/user/user.controller.ts:48` — `private requestCount = 0` keeps counting across requests (note 04 §1). Make `UserController` request-scoped and it would print `1` every time.
- `src/coffee/coffee.service.ts` — one instance, holding the two repositories, shared by every request.
- `src/main.ts` — `new ValidationPipe(...)` and `new TransformInterceptor()`: built by hand, so outside scopes entirely.

Nothing in this repo needs request scope yet. The first real candidate will be a request id for logging, or a tenant, when there are users.

## 7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| Use request scope to "fix" per-request state on a service | Works, but makes a whole branch of the app rebuild per request; the design problem (hidden inputs) is still there | every request pays; the next developer copies the pattern |
| Mark a widely-used service request-scoped | Bubbling makes its controllers and their dependencies request-scoped too, silently | average response time, and whoever profiles it later |
| Expect `@Inject(REQUEST)` to work in a singleton | There is no "current request" for an object built at startup; Nest errors or you get nothing useful | you, at startup |
| Keep a cache inside a request-scoped provider | It's thrown away after each request, so it never hits | whoever wonders why the cache does nothing |
| Use transient for something holding shared state | There is no shared instance any more; each consumer mutates its own copy | whoever debugs "the counter is always 1" |
| Rely on a startup failure from a request-scoped provider | It isn't built until a request arrives, so a bad config surfaces as a 500 instead of a failed boot | users, instead of the deploy |
| Reach for scopes before trying a parameter | Complexity with no benefit; parameters are free and obvious | everyone reading the code |

## 8. 🧠 Senior engineer lens

- **Lifetime is a design decision, not a syntax detail.** "How long does this thing live, and who shares it?" is the same question as note 04's two lifetimes, applied to objects instead of variables.
- **Bubbling means scope is contagious.** Before marking something request-scoped, look at who depends on it, and who depends on them. One `@Injectable({ scope })` can change the performance shape of half the app.
- **Prefer explicit data flow.** Passing `userId` down is boring, visible and free. Request scope is invisible machinery doing the same job with a runtime cost.
- **Multi-tenancy is the honest use case**, and it's also where the cost bites hardest, which is why durable providers exist (course 4): one instance per tenant instead of per request.
- **Singletons are safe here because Node is single-threaded** per process (note 04). In a thread-per-request language, this whole chapter would read differently. Knowing *why* a default is safe is what lets you reason about the edge cases.

## 9. 🔗 Connects to
- [04 — Requests, Shared State & the Event Loop](04-requests-shared-state-event-loop.md): the leak this feature is tempting to "fix", and the parameter-passing answer that's usually better
- [13 — Custom providers](13-custom-providers.md): the container and its cache; `scope` is one more key on a provider
- Part A above: dynamic modules
- Course 2: `@ActiveUser()` decorator, the cheap way to get per-request identity into a handler
- Course 4, videos 15–18: durable providers and multi-tenancy

## 10. ✍️ In my own words
> _(mine to write)_

## 11. 🛠️ Practice (Part B)

1. **See singleton.** Put `console.log('CoffeeService built')` in `CoffeeService`'s constructor. Start the app, send three `GET /coffee` requests, count the lines. (One, at startup.)
2. **See transient.** Add `@Injectable({ scope: Scope.TRANSIENT })`. Restart. How many lines now, before any request? Explain the number by counting who injects it.
3. **See request scope and bubbling.** Switch to `Scope.REQUEST`, add a `console.log` in `CoffeeController`'s constructor too, restart, and send three requests. Predict the number of lines *before* you look, then check.
4. **Use the request.** Build a tiny request-scoped `AuditService` that injects `REQUEST` and logs the request's IP and `user-agent` from inside `CoffeeService`. Notice you never passed the request down.
5. **Put it back.** Remove the scopes. This repo doesn't need them, and leaving them in would slow every request for no reason.

<details><summary>Hints</summary>

- 2: the count equals the number of classes that inject it, because each gets its own.
- 3: three per request-scoped class in the chain; the controller counts even though you never gave it a scope.
- 4: `import { REQUEST } from '@nestjs/core'`, and the service must be `Scope.REQUEST` itself.

</details>

## 12. ❓ Quiz (Part B)

**Q1.** `CoffeeService` is `Scope.REQUEST`. `CoffeeController` has no scope set. Three requests arrive. How many constructor logs, and why?

- A) 3: only the service is request-scoped
- B) 6: the controller depends on a request-scoped provider, so it becomes request-scoped too. Scope bubbles up the dependency chain
- C) 4: one controller at startup plus three services
- D) 3 at startup, then nothing

<details><summary>Answer</summary>

**B.** Nest can't give a per-request object to something built once at boot, so the whole chain above it is rebuilt per request. This is the main thing video 43 demonstrates, and the main reason request scope is more expensive than it looks.

</details>

**Q2.** Why is it safe for Nest to share one service object across all requests, when in some other languages that would be dangerous?

- A) Nest locks each request
- B) Node runs your JavaScript on one thread, one piece at a time, so two requests never execute inside the same object simultaneously. The real risk is state left on the object across the `await` gap, not simultaneous access
- C) Services are copied per request internally
- D) It isn't safe; that's why scopes exist

<details><summary>Answer</summary>

**B.** Note 04 §3.2. The danger is a *logical* race (read → await → write), not two threads touching the same memory.

</details>

**Q3.** A teammate makes `LoggerService` request-scoped so every log line can include a request id. It's injected by twelve services across the app. What happens?

- A) Only the logger is rebuilt per request
- B) All twelve services, and everything depending on them, become request-scoped: most of the app is now constructed on every request
- C) Nest refuses at startup
- D) Nothing changes until you inject REQUEST

<details><summary>Answer</summary>

**B.** Bubbling again, at scale. The usual alternatives: keep the logger a singleton and pass the request id in, or use durable providers / async local storage for context.

</details>

**Q4.** A request-scoped provider's `useFactory` throws because a config value is missing. When do you find out, compared with a singleton?

- A) At startup, the same as a singleton
- B) On the first request that touches it: a 500 in production instead of a failed deploy. Singletons are built at boot, so the same mistake would have stopped the app from starting
- C) Never; Nest skips it
- D) At build time

<details><summary>Answer</summary>

**B.** Losing the startup guarantee is a real cost of request scope, and easy to forget: failures move from deploy time to user time.

</details>

**Q5.** You need the current user's id inside a service three calls deep. Rank the options a senior would consider, best first.

- A) Request scope → parameter → durable provider
- B) Parameter (or a value read in the controller and passed down) → request scope only if threading it through is genuinely impractical → durable providers if it must be app-wide
- C) A global variable → request scope → parameter
- D) Transient scope → parameter

<details><summary>Answer</summary>

**B.** Passing data is free, visible and testable. Scopes are machinery with a per-request cost; reach for them when the alternative is touching every signature in a chain you don't own.

</details>
