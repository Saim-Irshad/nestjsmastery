# 03 — Modules, Controllers, Providers & Dependency Injection

> 📍 **Where on the Big Map:** Modules + DI happen at **server start** (once). Controllers + services run **per request** (the middle of the map).
> 🎥 **Video:** 00:08:18 – 00:30:23

## 1. The problem (why this exists)

Without DI you wire everything by hand:

```ts
const config = new ConfigService();
const logger = new LoggerService(config);
const db = new Database(config, logger);
const userService = new UserService(db, logger);
const hackathonService = new HackathonService(db, logger, userService);
const userController = new UserController(userService);
// ...50 more lines, in the RIGHT ORDER, updated every time a constructor changes
```

Problems: order matters, one constructor change ripples everywhere, and in tests you can't easily say
"give `UserService` a **fake** DB".

Nest's answer: **each class just declares what it needs in its constructor. Nest figures out the order and does the `new`s.**

## 2. Mental model

```
Module      = a department in a company, with a list of who works there
              and who it lends to other departments (exports)
Controller  = the reception desk: talks to customers (HTTP), passes work inside
Provider    = anyone who can be "assigned" to help (services, loggers, repositories, config values)
DI container= HR: when someone says "I need a logger", HR hands them THE logger
Decorator   = a sticky label on a class: "I'm a controller for /user", "I'm injectable"
```

Frontend link: DI is like **React Context**. A component doesn't create the theme or store; it *asks* for it, and a provider higher up supplies it.
Swap the provider → every consumer gets the new thing without changing their code.

## 3. How it works behind the scenes

### 3.1 Decorators are just functions that attach labels

```ts
@Controller('user')
export class UserController {}
```
is roughly:
```js
class UserController {}
Reflect.defineMetadata('path', 'user', UserController);   // sticky label on the class
```

They run **once, when the file loads**. They don't change behavior by themselves. **Nest reads the labels later.**

### 3.2 How Nest knows what to inject

```ts
@Injectable()
export class UserService {
  constructor(private readonly userLoggerService: UserLoggerService) {}
}
```

With `emitDecoratorMetadata: true` (in our `tsconfig.json`), TypeScript saves the constructor param types as a label:

```js
Reflect.defineMetadata('design:paramtypes', [UserLoggerService], UserService);
```

That's why the type must be a **class**: interfaces and `string` are erased and leave nothing to look up.

### 3.3 The container at startup (pseudo-code)

```js
const container = new Map();                 // Class → the one instance

function resolve(Class) {
  if (container.has(Class)) return container.get(Class);    // reuse → singleton
  const deps = Reflect.getMetadata('design:paramtypes', Class) ?? [];
  const args = deps.map(resolve);            // build dependencies first (recursive)
  const instance = new Class(...args);
  container.set(Class, instance);
  return instance;
}
```

```
 UserController ── needs ──► UserService ── needs ──► UserLoggerService
      3rd created                2nd created               1st created
```

Order in `providers: [...]` doesn't matter. The dependency graph decides.

### 3.4 Modules are boundaries

```ts
@Module({
  imports: [OtherModule],        // "I want to use what OtherModule exports"
  controllers: [UserController], // routes in this module
  providers: [UserService, UserLoggerService],  // things Nest creates for this module
  exports: [UserService],        // what other modules may inject (public API)
})
```

A provider is **private to its module unless exported**, like a file where only `export`ed functions can be imported.

### 3.5 Controllers: from decorators to Express routes

```ts
@Controller('user')
@Get('/:id')
getUserbyId(@Param('id') id: string)
```
Nest turns that into roughly:
```js
expressApp.get('/user/:id', async (req, res) => {
  const id = req.params.id;                         // from @Param('id')
  const result = await userController.getUserbyId(id); // SAME controller object every time
  res.status(200).json(result);                     // POST defaults to 201
});
```
Whatever you **return** becomes the response. No `res.send()` needed.

## 4. In our project

- [src/app.module.ts](../src/app.module.ts) imports [src/user/user.module.ts](../src/user/user.module.ts)
- `UserController` → `UserService` → `UserLoggerService`: a 3-level DI chain
- `@Query('name')`, `@Param('id')`, `@Body()` in [src/user/user.controller.ts](../src/user/user.controller.ts)

## 5. ❌ How NOT to do it

| Don't | What breaks |
|---|---|
| Forget to add a service to `providers` | Startup crash: `Nest can't resolve dependencies of UserService (?)`. The `?` marks which param is missing. |
| List the same provider in **two** modules' `providers` | You get **two instances**. Any state inside (cache, counters) silently splits. Put it in one module and `export` it. |
| `new UserService()` inside a class | Bypasses the container: a separate instance, dependencies not injected, can't mock in tests. |
| Mark everything `@Global()` | Hides dependencies. You can no longer tell what a module needs by reading its `imports`. |
| A needs B and B needs A (circular) | Startup error, or you reach for `forwardRef()`. Usually means the responsibilities are tangled; extract a third service. |
| Use `@Res()` and call `res.json()` yourself | You take over the response, so **interceptors can't transform it** and Nest's standard handling is skipped. Only do this when you really need raw control. |

## 6. 🧠 Senior engineer lens

- **DI = testability.** In a unit test: `new UserService(fakeLogger)` or Nest's `Test.createTestingModule` with `{ provide: UserLoggerService, useValue: fake }`. Your production code doesn't change at all.
- **Modules = team boundaries.** `exports` is a module's public API. Keep it small; everything else can change freely.
- **Depend on abstractions when it matters.** E.g. `PaymentService` receives a `PaymentGateway`. Swap Stripe for something else with one provider change (custom providers, Day 13).
- **Singletons + state = danger** (see [04](04-requests-shared-state-event-loop.md)).

## 7. 🔗 Connects to
- [02 — Classes](02-js-classes-objects-this.md): parameter properties, `this`
- [04 — Shared state](04-requests-shared-state-event-loop.md): consequence of one instance per provider
- Interceptors, guards, pipes and filters are **also** classes resolved by this same DI system

## 8. ✍️ In my own words
> _(write here)_

## 9. 🛠️ Practice

Create a `HackathonModule` (`src/hackathon/`) with a controller + service, where the service needs to **look up users** through the existing `UserService`.

1. First, **don't** add `exports`. Run the app and read the exact error message. Understand every word of it.
2. Fix it properly.
3. Then try the "wrong fix": add `UserService` to `HackathonModule`'s `providers` instead. It starts! Now `POST /user` a new user and look it up from a hackathon route. What happens and why?

<details><summary>Hints</summary>

- Generate quickly: `pnpm nest g module hackathon`, `pnpm nest g controller hackathon`, `pnpm nest g service hackathon`.
- Proper fix = two lines: one in `UserModule`, one in `HackathonModule`.
- Step 3: count the `users` arrays in memory. (Also: does it even start? `UserService` needs `UserLoggerService`...)

</details>

## 10. ❓ Quiz

**Q1.** `UserService` is in `UserModule.providers` (no `exports`). `AppModule` imports `UserModule`. `AppController` injects `UserService`. Result?

- A) Works, since `AppModule` imports `UserModule`
- B) Startup error: Nest can't resolve dependencies of `AppController`
- C) Works, but `AppController` gets a new separate instance
- D) Starts, and `this.userService` is `undefined` at request time

<details><summary>Answer</summary>

**B.** Importing a module only gives you its **exports**. Add `exports: [UserService]` to `UserModule`.
Nest fails **at startup**, which is good: you find out on deploy, not when a user hits the route.

</details>

**Q2.** `UserLoggerService` keeps an in-memory list of the last 100 log lines. Both `UserModule` and `HackathonModule` list it in their own `providers`. An admin endpoint shows "last 100 logs". What does the admin see?

- A) All logs from both modules
- B) Only the logs from whichever module's instance the admin controller received. There are two separate instances.
- C) Startup error: duplicate provider
- D) Depends on import order, but always one merged instance

<details><summary>Answer</summary>

**B.** One provider **per module that declares it** means two objects and two lists. No error, just silently wrong data: the worst kind of bug.

</details>

**Q3.**
```ts
export interface UserRepo { findById(id: number): Promise<User> }

@Injectable()
export class UserService {
  constructor(private readonly repo: UserRepo) {}
}
```
- A) Works, Nest finds a class that implements `UserRepo`
- B) Startup error: interfaces are erased at compile time, so Nest has no runtime token to look up
- C) TypeScript compile error
- D) Works only if `UserRepo` is exported

<details><summary>Answer</summary>

**B.** At runtime `design:paramtypes` has `Object` for that param, so there's nothing to look up. Fix: a token + `@Inject()`:
`{ provide: 'USER_REPO', useClass: PrismaUserRepo }` and `constructor(@Inject('USER_REPO') private repo: UserRepo)`.
TypeScript is happy (interfaces are allowed as types), so this is a **runtime-only** failure.

</details>

**Q4.** Why does Nest create controllers and services **once** (singleton) by default instead of per request?

- A) Nest can't create per-request objects
- B) Creating the whole object graph per request costs CPU/memory on every request, and most services hold no per-request data anyway
- C) Singletons are required by Express
- D) So services can safely store the current user on `this`

<details><summary>Answer</summary>

**B.** Per-request scope (`Scope.REQUEST`) exists, but it re-creates the object **and everything that depends on it** for every request.
**D is exactly the bug singletons make dangerous** (note 04).

</details>
