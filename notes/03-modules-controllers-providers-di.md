# 03 — Modules, Controllers, Providers & Dependency Injection

> 📍 **Where on the Big Map:** Modules + DI happen at **server start** (once). Controllers + services run **per request** (the middle of the map).
> 📘 **Course:** video 7 (basic controller) · 8 (route parameters) · 9 (request body) · 13 (basic service) · 15 (modules); videos 33–34 (DI deep dive, module encapsulation) extend this note · 🎥 **YouTube video:** 00:08:18 – 00:30:23 · 🌿 **Branch:** `main`

## 1. The problem

This project has three chains of objects that need each other:

```
UserController  → UserService  → UserLoggerService
AppController   → AppService
CoffeeController → CoffeeService → (a TypeORM repository → the Postgres connection)
```

Nobody in `src/` ever writes `new UserService(...)`. Something has to. If you wrote that something by hand, in `main.ts`, it would look like this:

```ts
const config = new ConfigService();
const logger = new LoggerService(config);
const db = new Database(config, logger);
const userService = new UserService(db, logger);
const hackathonService = new HackathonService(db, logger, userService);
const userController = new UserController(userService);
// ...50 more lines, in the RIGHT ORDER, updated every time a constructor changes
```

And then, for every controller method, a line like `app.get('/user/:id', (req, res) => res.json(userController.getUserbyId(Number(req.params.id))))`.

What goes wrong with this is not that it fails. It works. It goes wrong slowly:

- **Order matters.** `userService` must exist before `hackathonService`. With 50 objects, adding one means finding the right line to put it after.
- **One constructor change ripples.** Give `UserService` a new dependency and `main.ts` changes too, and so does every test that builds a `UserService`.
- **Tests cannot swap parts.** To test `UserService` with a fake database you must rebuild the whole chain yourself, every time.
- **The file becomes the thing nobody wants to touch.** It knows about every class in the app.

Nest's answer: **each class declares what it needs in its constructor. Nest figures out the order and calls `new` for you.**

## 2. Mental model

Think of the app as a company. Each **module** is a department, with a list of who works there and which of its staff it lends to other departments. A **controller** is the reception desk: it talks to customers (HTTP) and passes the work inside. A **provider** is anyone who can be assigned to help: services, loggers, repositories, config values. The **DI container** is HR: when someone says "I need a logger", HR hands them *the* logger, the same one everybody else got. A **decorator** is a sticky label on a class: "I'm the reception desk for `/user`", "I'm injectable".

Frontend comparison: this is **React Context**. A component does not create the theme or the store; it *asks* for it, and a provider higher up supplies it. Swap the provider and every consumer gets the new thing without changing their code.

## 3. Baby steps

### Step 1: naive. Hand wiring in `main.ts`

```js
// functional, all by hand
const logger = createUserLogger();
const userService = createUserService(logger);
const userController = createUserController(userService);

app.get('/user/:id', (req, res) => {
  res.json(userController.getUserbyId(Number(req.params.id)));
});
```

This is fine at three objects and one route. **What breaks** is described in section 1: order, ripple, tests, and the file that knows everything. A second, quieter problem: if two developers each write `createUserService(...)` in their own file, there are now two services with two separate `users` arrays, and data saved through one is invisible through the other.

### Step 2: better. Let each class say what it needs, and write a tiny builder

If each class *declares* its needs in its constructor, a ten-line function can do the wiring:

```js
const container = new Map();                 // Class → the one instance

function resolve(Class) {
  if (container.has(Class)) return container.get(Class);    // reuse → one shared object
  const deps = Class.needs ?? [];                            // what does it want?
  const args = deps.map(resolve);            // build dependencies first (recursive)
  const instance = new Class(...args);
  container.set(Class, instance);
  return instance;
}

class UserService { static needs = [UserLoggerService]; constructor(logger) { ... } }
const userController = resolve(UserController);   // builds the logger, then the service, then the controller
```

Now order does not matter, adding a dependency means editing one class, and a test can put a fake in the map before calling `resolve`.

**What is still wrong:** the `static needs = [...]` line is duplicated information. The constructor already says `constructor(logger: UserLoggerService)`; the type is right there. But TypeScript erases types when it compiles, so at runtime `resolve` has nothing to read. The list has to be written twice, by hand, and the two copies drift.

### Step 3: better again. Get the constructor types to survive compilation

TypeScript has a switch for exactly this. With `emitDecoratorMetadata: true` (it is on in this repo's `tsconfig.json`), any class that has at least one decorator gets its constructor parameter types written into the compiled JS as a label. That is the real reason `@Injectable()` exists: it is a decorator, so it makes TypeScript emit the label. This is what `src/user/user.service.ts` becomes at `dist/user/user.service.js:66-69`:

```js
exports.UserService = UserService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [user_logger_service_1.UserLoggerService])
], UserService);
```

`resolve` can now read `Reflect.getMetadata('design:paramtypes', UserService)` and get `[UserLoggerService]` without anyone writing it twice.

**What is still wrong:** everything lives in one global bag. With 30 providers, nobody can tell which ones `UserService` is allowed to use. Two teams both write a `LoggerService` and they collide. Any class can reach any other class, so there are no boundaries, and a change anywhere can break anything.

### Step 4: what a senior does. Draw boundaries around features

Group the classes by feature, and make each group say what it lends out:

```ts
@Module({
  controllers: [UserController],
  providers: [UserService, UserLoggerService],
  exports: [UserService],                    // the only thing other features may borrow
})
export class UserModule {}
```

Inside the group, everything can see everything. From outside, only the exported things are visible. The public surface is small, so most changes are safe.

Now the names, all at once: the objects Nest builds and hands around are **providers**; asking for them in the constructor instead of creating them is **dependency injection (DI)**; the `Map` plus `resolve` is the **DI container**; the label `@Injectable()` triggers is **metadata**; and the boundary with its `providers`/`exports` lists is a **module**. The whole design of "declare what you need and let the framework build it" is sometimes called **inversion of control**, because the framework calls your code rather than the other way round.

## 4. How it works underneath

### 4.1 Decorators are functions that attach labels

```ts
@Controller('user')
export class UserController {}
```
is roughly:
```js
class UserController {}
Reflect.defineMetadata('path', 'user', UserController);   // sticky label on the class
```

They run **once, when the file loads**. They don't change behavior by themselves. **Nest reads the labels later**, at startup. The comment at `src/app.module.ts:22-30` writes out `@Module` this way: a function that receives the options, returns a function that receives the class, and stores three labels on it.

### 4.2 How Nest knows what to inject

```ts
@Injectable()
export class UserService {
  constructor(private readonly userLoggerService: UserLoggerService) {}
}
```

With `emitDecoratorMetadata: true` (in this repo's `tsconfig.json`), TypeScript saves the constructor param types as a label:

```js
Reflect.defineMetadata('design:paramtypes', [UserLoggerService], UserService);
```

That's why the type must be a **class**: interfaces and `string` are erased and leave nothing to look up. An interface becomes `Object` in that list, and Nest cannot find "an `Object`" in the container (Q3 below).

### 4.3 The container at startup

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

Order in `providers: [...]` doesn't matter. The dependency graph decides. The comment at `src/user/user.module.ts:24-39` draws the same picture and the `Map` for this exact module.

### 4.4 The whole startup, file by file

```
 pnpm start:dev
   │
   ▼
 src/main.ts:38            NestFactory.create(AppModule)
   │
   ├─ read the @Module label on AppModule            src/app.module.ts:39
   │    imports: [UserModule, TypeOrmModule.forRoot(...), CoffeeModule]
   │
   ├─ follow imports, read their labels               src/user/user.module.ts:13
   │                                                  src/coffee/coffee.module.ts:12
   │
   ├─ for each module, resolve() every provider and controller
   │    new UserLoggerService()                       src/user/user.logger.service.ts:13
   │    new UserService(logger)                       src/user/user.service.ts:43
   │    new UserController(userService)               src/user/user.controller.ts:42
   │    ...same for AppService/AppController, CoffeeService/CoffeeController
   │
   ├─ read @Controller/@Get/@Post labels, register Express routes
   │    GET  /user        → userController.getUser        src/user/user.controller.ts:58
   │    GET  /user/:id    → userController.getUserbyId    src/user/user.controller.ts:99
   │    POST /user        → userController.createUser     src/user/user.controller.ts:121
   │    PUT  /user/:id    → userController.updateUser     src/user/user.controller.ts:139
   │
   ▼
 src/main.ts:73            app.listen(3000)   ← only now does the server accept requests
```

Everything above the last line happens once. If any `resolve()` fails, the process exits before listening, which is why a missing provider is a startup crash and never a runtime surprise.

### 4.5 Modules are boundaries

```ts
@Module({
  imports: [OtherModule],        // "I want to use what OtherModule exports"
  controllers: [UserController], // routes in this module
  providers: [UserService, UserLoggerService],  // things Nest creates for this module
  exports: [UserService],        // what other modules may inject (public API)
})
```

A provider is **private to its module unless exported**, like a file where only `export`ed functions can be imported.

### 4.6 The four keys of `@Module({...})`, in depth (course videos 15 and 34)

The VS Code tooltip shows `controllers?: Type<any>[]`. Reading that type:
- `ModuleMetadata`: the name of the **shape of the object** you pass to `@Module(...)`. It only has these 4 keys.
- `?`: optional. You can leave any key out (`@Module({})` is valid, and AppModule-style modules often have no controllers).
- `Type<any>`: Nest's way of saying **"a class"** (something you can call `new` on). Not an instance: you write `CoffeesService`, never `new CoffeesService()`.
- `[]`: an array of them.

**The picture: a module is a department with a locked door.**

```
                    ┌──────────── CoffeesModule ─────────────┐
 imports ──────────►│  controllers: [CoffeesController]      │  ← the reception desk (routes)
 "what I BORROW     │  providers:   [CoffeesService,         │  ← the staff Nest hires (creates)
  from other        │                CoffeesRepo]            │
  departments"      │  exports:     [CoffeesService]  ───────┼──► "who I LEND to departments
                    └────────────────────────────────────────┘     that import me"
```

| Key | Takes | Nest does | Question it answers |
|---|---|---|---|
| `controllers` | controller classes | `new`s them once and registers their `@Get/@Post` routes | "Which URLs does this module handle?" |
| `providers` | services & other injectables | `new`s them once (per module) and makes them injectable **inside this module** | "Which workers live here?" |
| `exports` | a **subset of `providers`** (or imported modules) | makes those injectable **in modules that import this one** | "Which workers may other modules use?" |
| `imports` | other **modules** (never services) | gives this module access to **their exports** | "Whose workers do I need?" |

Frontend link: it's exactly **ES module `import`/`export`**, but for *instances*:
```js
// coffees.module "file"
const coffeesService = new CoffeesService();   // providers
const secretHelper   = new Helper();           // providers (not exported → private)
export { coffeesService };                     // exports

// coffee-rating.module "file"
import { coffeesService } from './coffees.module';   // imports: [CoffeesModule]
```

**Real example from the course (video 34, CoffeeRatingModule):**

```ts
// coffees.module.ts
@Module({
  controllers: [CoffeesController],
  providers: [CoffeesService],
  exports: [CoffeesService],          // ① lend it out
})
export class CoffeesModule {}

// coffee-rating.module.ts
@Module({
  imports: [CoffeesModule],           // ② borrow from CoffeesModule
  providers: [CoffeeRatingService],   //    CoffeeRatingService's constructor asks for CoffeesService → works
})
export class CoffeeRatingModule {}
```
Remove ① **or** ② and startup fails with `Nest can't resolve dependencies of the CoffeeRatingService (?)`.

**Classic mistakes:**

| Mistake | What happens |
|---|---|
| `imports: [CoffeesService]` (a service in imports) | Startup error: `imports` only accepts modules. |
| `exports: [X]` but X isn't in `providers` (or an imported module) | Startup error: you can't lend what you don't have. |
| Instead of importing, adding `CoffeesService` to `CoffeeRatingModule.providers` too | Starts fine, but now there are **two** `CoffeesService` objects with separate state (Q2 below). Its own dependencies must also be re-listed. |
| Exporting controllers | Makes no sense. Controllers are never injected into anything; they're entry points. |
| Exporting everything "in case" | The module has no private parts left, so any change can break someone. Keep `exports` small: it's the module's public API. |

**Two more things you'll see soon:**
- `imports` also accepts **configured modules**: `TypeOrmModule.forRoot({...})`, `ConfigModule.forRoot()`. In this repo, `src/app.module.ts:57` is one of them. These are modules built by a function at startup instead of written out by hand (dynamic modules, course video 41).
- `providers` also accepts **objects** instead of classes: `{ provide: 'API_KEY', useValue: 'abc' }` (custom providers, course videos 35–40).

### 4.7 Controllers: from decorators to Express routes

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
Whatever you **return** becomes the response. No `res.send()` needed. The parameter decorators (`@Param`, `@Query`, `@Body`) are labels too: each one says "this argument comes from this part of the request", and Nest reads them to build the argument list before calling your method.

## 5. Functional vs class

Two places where a class is doing a job you would do with a function or an object.

**The module.** The comment at `src/app.module.ts:35-37` says it: a module is a list. Functionally you would write the list as an object.

```js
// functional: a plain object
const UserModule = {
  controllers: [UserController],
  providers: [UserService, UserLoggerService],
  exports: [UserService],
};
```

```ts
// Nest: an empty class with the list stuck on as a label
@Module({
  controllers: [UserController],
  providers: [UserService, UserLoggerService],
  exports: [UserService],
})
export class UserModule {}
```

The class body is empty on purpose (`src/app.module.ts:93-95`). What the class buys here is small but real: it is a unique runtime value that `imports: [UserModule]` can point at, that Nest can attach more labels to (`@Global()`), and that static methods like `forRoot()` can hang off. What it costs: a beginner reads "class" and expects behaviour that is not there.

**The dependency.** A function receives its collaborators as parameters; a class receives them in the constructor and keeps them on `this`.

```js
// functional: closure holds the dependency
function createUserService(userLoggerService) {
  return {
    getUserByName(name) {
      userLoggerService.log(`Searching for user with name: ${name}`);
      // ...
    },
  };
}
const userService = createUserService(createUserLogger());   // you wire it
```

```ts
// class: the constructor holds the dependency
@Injectable()
export class UserService {
  constructor(private readonly userLoggerService: UserLoggerService) {}
  getUserByName(name: string) {
    this.userLoggerService.log(`Searching for user with name: ${name}`);
    // ...
  }
}
// Nest wires it: new UserService(resolve(UserLoggerService))
```

**What the class version buys:** the parameter *type* is a class, so with `emitDecoratorMetadata` it survives compilation and the container can read it. A factory function's parameters have no runtime types, so a framework cannot know what to pass in; you would be back to writing the list twice (step 2 above). The class also gives Nest one object per provider to share, which is what makes swapping a fake in tests a one-line change.

**What it costs:** the `this` rules (note 02), and a dependency graph that is checked at startup instead of by the compiler. Interfaces cannot be injected by type because they vanish at compile time (Q3), so abstractions need explicit tokens (custom providers, Day 13).

**When to pick which:** inside Nest, the class, because the container needs the metadata. In a script or a helper library, the factory function is lighter and the wiring is three lines you can read.

## 6. In my project

- `src/main.ts:38`: `NestFactory.create(AppModule)`, the single call that does everything in section 4.4. The comment at `src/main.ts:23-35` lists the steps.
- `src/app.module.ts:39-95`: the root module. `:42-81` `imports` (including `TypeOrmModule.forRoot(...)` at `:57`, a configured module), `:85` `controllers`, `:91` `providers`. The comment at `:15-38` writes `@Module` out as a plain function.
- `src/user/user.module.ts:13-42`: the feature module. `:16-22` explains why both services must be in `providers`, and gives the exact startup error when one is missing: `Nest can't resolve dependencies of the UserService (?)`. The `?` marks which constructor argument Nest could not build. `:24-39` draws the creation order and the container `Map`.
- `src/user/user.controller.ts:23` `@Controller('user')` · `:42` constructor asking for `UserService` · `:58-59` `@Get()` + `@Query('name')` · `:99-100` `@Get('/:id')` + `@Param('id', ParseIntPipe)` · `:121-122` `@Post()` + `@Body()` · `:139-143` `@Put('/:id')` combining `@Param` and `@Body`. A 3-level DI chain: `UserController → UserService → UserLoggerService`.
- `src/user/user.service.ts:15` `@Injectable()` · `:43` the constructor that declares the need · `:107` using the injected logger.
- `src/user/user.logger.service.ts:12-13`: the leaf of the chain, no dependencies, created first.
- `src/coffee/coffee.module.ts:23`: `TypeOrmModule.forFeature([Coffee, Flavor])` in `imports`, which is how `CoffeeService` gets its repository injected. `:28-29`: `CoffeeService` is not exported, so no other module can inject it yet.
- `src/app.controller.ts:40`: the same constructor pattern on the smallest example, with the comment explaining who calls it.
- `dist/user/user.service.js:66-69`: the emitted `design:paramtypes` label, quoted in section 3.

## 7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| Forget to add a service to `providers` | Startup crash: `Nest can't resolve dependencies of UserService (?)`. The `?` marks which param is missing. | You, at deploy time, which is the good place to find out |
| Leave `@Injectable()` off a class that has constructor dependencies | No decorator means TypeScript emits no `design:paramtypes`, so Nest treats the class as needing nothing and calls `new` with no arguments. Startup succeeds; the first request that touches the missing dependency throws `TypeError: Cannot read properties of undefined` (Q5). | A real user, at request time, instead of you at deploy time |
| List the same provider in **two** modules' `providers` | You get **two instances**. Any state inside (cache, counters) silently splits. Put it in one module and `export` it. | Whoever reads the "last 100 logs" page and sees half of them (Q2) |
| `new UserService()` inside a class | Bypasses the container: a separate instance, dependencies not injected, can't mock in tests. | The next developer's tests, and anyone relying on the shared instance's data |
| `imports: [SomeService]` (a service where a module belongs) | Startup error. `imports` only takes modules. | You, with a confusing error message until you know this rule |
| `exports: [X]` where X is not in `providers` | Startup error. You cannot lend what you do not have. | You, at startup |
| Mark everything `@Global()` | Hides dependencies. You can no longer tell what a module needs by reading its `imports`. | The team, six months later, when nobody can delete anything safely |
| A needs B and B needs A (circular) | Startup error, or you reach for `forwardRef()`. Usually means the responsibilities are tangled; extract a third service. | Whoever has to untangle it under time pressure |
| Use `@Res()` and call `res.json()` yourself | You take over the response, so **interceptors can't transform it** and Nest's standard handling is skipped. Only do this when you really need raw control. | The frontend, which now gets one response without the standard envelope |

## 8. 🧠 Senior engineer lens

**DI is testability.** In a unit test you can write `new UserService(fakeLogger)` directly, or use Nest's `Test.createTestingModule` with `{ provide: UserLoggerService, useValue: fake }`. Your production code does not change at all. That is the payoff for declaring needs in the constructor.

**Modules are team boundaries.** `exports` is a module's public API. Keep it small; everything else can change freely. A module that exports everything is a folder, not a boundary.

**Depend on abstractions when it matters.** A `PaymentService` should receive a `PaymentGateway`, not a `StripeClient`. Swapping Stripe for something else becomes one provider change (custom providers, Day 13). Because interfaces vanish at compile time, this needs an explicit token, which is the first place the "types are erased" fact bites in real design.

**Singletons plus state is danger.** One instance per provider means every field is shared by every request the server ever handles (see [04](04-requests-shared-state-event-loop.md)).

**Startup failures are a feature.** A wiring mistake stops the process before `app.listen`. A framework that let the server start and then failed on the first request would hurt a real user instead of you. Read the `?` in the error, count the constructor parameters, and the missing one is right there.

## 9. 🔗 Connects to
- [02 — Classes](02-js-classes-objects-this.md): parameter properties, `this`
- [04 — Shared state](04-requests-shared-state-event-loop.md): consequence of one instance per provider
- Interceptors, guards, pipes and filters are **also** classes resolved by this same DI system

## 10. ✍️ In my own words
> _(write here)_

## 11. 🛠️ Practice

Create a `HackathonModule` (`src/hackathon/`) with a controller + service, where the service needs to **look up users** through the existing `UserService`.

1. First, **don't** add `exports`. Run the app and read the exact error message. Understand every word of it.
2. Fix it properly.
3. Then try the "wrong fix": add `UserService` to `HackathonModule`'s `providers` instead. It starts! Now `POST /user` a new user and look it up from a hackathon route. What happens and why?

<details><summary>Hints</summary>

- Generate quickly: `pnpm nest g module hackathon`, `pnpm nest g controller hackathon`, `pnpm nest g service hackathon`.
- Proper fix = two lines: one in `UserModule`, one in `HackathonModule`.
- Step 3: count the `users` arrays in memory. (Also: does it even start? `UserService` needs `UserLoggerService`...)

</details>

## 12. ❓ Quiz

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

**B.** One provider **per module that declares it** means two objects and two lists. No error, only silently wrong data: the worst kind of bug.

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

**Q5.** A developer removes `@Injectable()` from `UserLoggerService`, which has no constructor and no dependencies, and leaves it in `providers`. Then they remove it from `UserService` too, which does depend on the logger. What happens?

- A) Both keep working; `@Injectable()` is only documentation
- B) The logger keeps working; `UserService` fails at startup with `Nest can't resolve dependencies of the UserService (?)`
- C) Both fail at startup: every provider must have `@Injectable()`
- D) Both start. `UserService` is built with no arguments, so `this.userLoggerService` is `undefined`, and the first `GET /user?name=...` crashes with a `TypeError` inside `getUserByName`

<details><summary>Answer</summary>

**D.** Section 3, step 3: the constructor types survive compilation only because a decorator is present, which makes TypeScript emit the `design:paramtypes` label. Remove the decorator and the compiled file has no label at all (compare `dist/user/user.service.js:66-69`, which would be gone). The logger has no parameters, so nothing is lost there. For `UserService`, the container asks for the label, finds nothing, and treats that as "needs nothing" (in `@nestjs/core`'s injector the lookup is `Reflect.getMetadata(...) || []`). So it calls `new UserService()` with no arguments, startup succeeds, and the bug waits until a request reaches `this.userLoggerService.log(...)` at `src/user/user.service.ts:107`. That is worse than a startup error, and it is why the habit is to always put `@Injectable()` on providers even when they have no dependencies yet: the day someone adds one, the label is already being emitted. B is what happens when the provider is missing from `providers`; it is not what happens here.

</details>
