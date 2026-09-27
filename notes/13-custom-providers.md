# 13 — Custom providers: who fills in your function's arguments?

> 📍 **Where on the Big Map:** SERVER START. Everything in this note happens once, before the first request, while Nest builds your objects.
> 📘 **Course:** videos 33 (Understand DI) · 34 (Module Encapsulation) · 35 (Custom providers) · 36 (`useValue`) · 37 (string tokens, `@Inject`) · 38 (`useClass`) · 39 (`useFactory`) · 40 (async providers)
> 🌿 **Branch:** `dependency-injection`
> Builds on [03 — Modules, Controllers, Providers & DI](03-modules-controllers-providers-di.md).

## 1. The problem

Start from something you write every day in functional code. A function that needs some things to do its job gets them **as arguments**:

```js
function makeCoffeeService(coffeeTable, flavorTable) {
  return {
    findAll: () => coffeeTable.find(),
    create: (dto) => { /* uses flavorTable */ },
  };
}
```

Nothing unusual. But now ask a question you normally don't have to think about: **who calls this function, and where do the arguments come from?**

Somebody has to write, somewhere:

```js
const db = await connectToPostgres(config);
const coffeeTable = db.table('coffee');
const flavorTable = db.table('flavor');
const coffeeService = makeCoffeeService(coffeeTable, flavorTable);   // ← this line
const coffeeController = makeCoffeeController(coffeeService);         // ← and this one
```

In a small app that's fine. In an app with forty services, this file is long, the lines have to be in the right order (you can't make the service before the tables exist), and every time a function grows a new argument, this file changes too. Want a fake `coffeeTable` in a test? You write this whole chain again with the fake in it.

**That's the entire problem these seven videos are about: who makes the calls, and where do the arguments come from.** Nest's answer is "we'll make the calls for you, and we'll fill in the arguments from a list you give us." Everything else in the chapter is the details of that list.

## 2. Mental model

**A phone book.** You don't carry your friends around with you. You carry their names, and when you need one, you look them up. Nest keeps a phone book of your services. When one of your functions needs something, Nest looks it up by name and hands it over.

The frontend version you already know: React Context. A component doesn't create the theme; it asks for it by name (`useContext(ThemeContext)`), and whoever set up the provider higher up decides what it gets. Change the provider once, every consumer gets the new thing, no consumer edits.

## 3. Baby steps

### Step 1 — Your function's arguments become a constructor

First, the shape change from functional to class, and nothing else. This:

```js
function makeCoffeeService(coffeeTable, flavorTable) {
  return { findAll: () => coffeeTable.find() };
}
```

becomes this:

```ts
class CoffeeService {
  constructor(private readonly coffeeTable, private readonly flavorTable) {}   // same argument list
  findAll() { return this.coffeeTable.find(); }
}
```

The **constructor's parameter list is the function's argument list.** Same two things, same order. (`private readonly` stores them on the object so the methods can reach them; note 02.) You'd still call it yourself: `new CoffeeService(coffeeTable, flavorTable)`.

### Step 2 — Nest makes the call for you

Now the actual trick. Instead of you writing `new CoffeeService(coffeeTable, flavorTable)`, you tell Nest two things:

```ts
@Injectable()                                        // "Nest, you're allowed to build this one"
export class CoffeeService {
  constructor(private readonly coffeeTable: CoffeeTable) {}   // "and here's what I need"
}

@Module({ providers: [CoffeeService, CoffeeTable] })  // "these are the things you may build"
export class CoffeeModule {}
```

And at startup Nest does the `new` itself. It reads the constructor, sees "I need a `CoffeeTable`", looks up `CoffeeTable` in its list, builds that first if needed, then calls `new CoffeeService(theCoffeeTable)`.

You stopped writing the wiring file. Nest writes it, every startup, from the constructors. That's video 33.

**What Nest is roughly doing** for each class, in plain JS:

```js
function build(Class) {
  const needs = whatTheConstructorAsksFor(Class);   // e.g. [CoffeeTable]  ← read from the constructor
  const args = needs.map(build);                      // build each of those first
  return new Class(...args);                          // then make this one
}
```

Three lines. "Read the argument list, build the arguments, call `new`."

### Step 3 — The list is a phone book: a name on the left, a thing on the right

Look at `providers: [CoffeeService, CoffeeTable]` again. It reads like a plain list, but each entry is really a **pair**: a name to look up, and what to hand over. The list form is a shortcut for writing the pair out:

```ts
providers: [CoffeeService]
// is exactly the same as
providers: [{ provide: CoffeeService, useClass: CoffeeService }]
//            ^^^^^^^ the name          ^^^^^^^^ what to hand over: "make one of these"
```

That's video 35's whole message: you've been writing the pair all along, in short form.

Why does the long form exist? Because **the two halves can be different.** The name someone asks for, and the thing they get, don't have to be the same. Steps 4 to 6 are the three useful ways they can differ.

### Step 4 — Hand over a ready-made thing (`useValue`)

Sometimes you don't want Nest to build anything. You already have the thing.

```ts
const fakeCoffeeService = { findAll: () => ['fake latte'] };

providers: [{ provide: CoffeeService, useValue: fakeCoffeeService }]
```

Now anyone whose constructor asks for `CoffeeService` gets that plain object instead. The controller doesn't know and doesn't care. That's how tests swap in fakes (`src/coffee/coffee.controller.spec.ts` does exactly this). Video 36.

Functionally: it's putting a constant on the right-hand side.

### Step 5 — When the name can't be a class (`@Inject` and string names)

So far the name on the left has always been a class, and Nest reads it from the constructor's **type**:

```ts
constructor(private readonly coffeeService: CoffeeService) {}   // Nest reads "CoffeeService" from here
```

That works because a class still exists after TypeScript is compiled to JavaScript. Now try to ask for an array of brand names:

```ts
constructor(private readonly brands: string[]) {}   // ❌
```

`string[]` doesn't exist after compiling. Nest reads the type and sees only "Array". It has nothing called Array in its phone book, and startup fails. So for anything that isn't a class, **you pick the name yourself**, and write it in both places:

```ts
// coffees.constants.ts: the name, in one place, so a typo can't happen twice
export const COFFEE_BRANDS = 'COFFEE_BRANDS';

// the module: register under that name
providers: [{ provide: COFFEE_BRANDS, useValue: ['buddy brew', 'nescafe'] }]

// the service: ask by that name, because the type can't say it
constructor(@Inject(COFFEE_BRANDS) private readonly brands: string[]) {}
```

`@Inject(X)` means only this: "look up X, instead of looking up my type." You've used it already without noticing: `@InjectRepository(Coffee)` is `@Inject('CoffeeRepository')` with a friendlier name. Video 37.

### Step 6 — Decide which class at startup (`useClass`)

Same name, different class depending on the situation. Everyone asks for `ConfigService`; what they get is decided once, when the app boots:

```ts
providers: [{
  provide: ConfigService,
  useClass: process.env.NODE_ENV === 'production' ? ProductionConfigService : DevelopmentConfigService,
}]
```

The services asking for `ConfigService` never change. Video 38.

Functionally: it's choosing which factory function to call.

### Step 7 — Build the thing with a function that can ask for other things (`useFactory`)

Sometimes making the thing takes steps, or needs other entries from the phone book first. Then you give Nest a **function** to call, and tell it what to pass in:

```ts
providers: [{
  provide: COFFEE_BRANDS,
  useFactory: async (coffeeService: CoffeeService) => {   // Nest calls this...
    const coffees = await coffeeService.findAll({});
    return [...new Set(coffees.map((c) => c.brand))];       // ...and hands over what it returns
  },
  inject: [CoffeeService],                                  // ...after looking these up for it
}]
```

`inject` is the function's argument list, the same way a constructor is a class's argument list. Nest looks up `CoffeeService`, calls your function with it, and stores the result under `COFFEE_BRANDS`. If the function is `async`, Nest waits for it before starting the app. Video 39.

Functionally: it's the most familiar of all. It *is* a function call with arguments.

### Step 7b — When building the thing takes time (video 40, async providers)

Some things can't be built instantly. A database connection has to be opened, and until it's open, nothing that uses it can work. You do **not** want the server accepting requests while that's still happening: every one of them would crash on a connection that isn't there.

The fix is one keyword. A factory may be `async`:

```ts
providers: [{
  provide: COFFEE_BRANDS,
  useFactory: async (connection: DataSource) => {
    const brands = await connection.query('SELECT DISTINCT brand FROM coffee');   // takes a moment
    return brands.map((row) => row.brand);
  },
  inject: [DataSource],
}]
```

Nest **waits for the promise** before it builds anything that asks for `COFFEE_BRANDS`, and before the app starts listening. Put a `console.log` in the factory and another in the constructor of the service that uses it, and they always print in that order: factory first, constructor second. Never the other way around, no matter how slow the factory is.

That's the whole feature. Same phone book, same entry, except the right-hand side is a promise and Nest awaits it.

Why it matters more than it looks: without it you'd be back to writing "is the connection ready yet?" checks in your services, or getting a crash on the first request after a deploy. Startup order stops being something you manage. It also means **a dependency that can't be built stops the boot**: if the database is down, the app fails to start instead of starting and failing every request. A loud failure at deploy time beats a quiet one at 3am.

This is exactly what `TypeOrmModule.forRoot()` does inside (note 09 §3.1b). The log line `TypeOrmModule dependencies initialized` is its factory's promise resolving, and `Nest application successfully started` can't appear before it.

### Step 8 — Each module has its own phone book (video 34, encapsulation)

If there were one phone book for the whole app, every service could grab every other service and nobody could tell what depends on what. So **each module keeps its own book**, and lists which entries other modules may copy:

```ts
@Module({
  providers: [CoffeeService],   // in my book
  exports: [CoffeeService],     // other modules that import me may look this up
})
export class CoffeeModule {}

@Module({
  imports: [CoffeeModule],      // copy CoffeeModule's exported entries into my book
  providers: [CoffeeRatingService],   // whose constructor asks for CoffeeService
})
export class CoffeeRatingModule {}
```

Forget the `exports` line and the app won't start:

```
Nest can't resolve dependencies of the CoffeeRatingService (?).
Please make sure that the argument CoffeesService at index [0] is available in the CoffeeRatingModule context.
```

"available in the CoffeeRatingModule context" means "in that module's phone book". The `(?)` marks which constructor argument couldn't be found, and `index [0]` says it's the first one.

### The words the videos use, translated

You now know everything the chapter teaches. Here are the names the videos put on it:

| The video says | It means |
|---|---|
| dependency | an argument your constructor asks for |
| provider | one entry in the phone book (a name and what to hand over) |
| token | the name on the left of an entry |
| container / IoC container | the phone book itself, plus the code that does the `new`s |
| inject | pass in as an argument |
| resolve | look up a name, building the thing if it isn't built yet |
| dependency injection | "Nest fills in the arguments from the phone book" |
| inversion of control | "Nest calls your constructor; you don't" |
| singleton | built once, then the same object handed to everyone |

That's five words for one Map and one `new`.

## 4. How it works underneath

Startup, in plain JS, a little closer to the real thing than step 2:

```js
const cache = new Map();

function resolve(name, book) {
  if (cache.has(name)) return cache.get(name);          // built already → same object again
  const entry = book.get(name);
  if (!entry) throw new Error(`Nest can't resolve ${name}`);

  let thing;
  if (entry.useValue)   thing = entry.useValue;                                            // step 4
  if (entry.useClass)   thing = new entry.useClass(...needsOf(entry.useClass).map((n) => resolve(n, book)));   // steps 2, 6
  if (entry.useFactory) thing = entry.useFactory(...(entry.inject ?? []).map((n) => resolve(n, book)));        // step 7

  cache.set(name, thing);
  return thing;
}
```

`needsOf(Class)` reads the constructor's parameter types. TypeScript writes them down for Nest when it compiles (`design:paramtypes`, note 03), and an `@Inject(name)` on a parameter swaps that slot's type for the name you gave.

The flow, file by file:

```
 main.ts:38   NestFactory.create(AppModule)
   │  read every @Module(): providers → its book; imports → copy the other module's exports in
   ▼
 for each controller and provider:   resolve(name, book)
   │  CoffeeController asks for [CoffeeService]
   │    CoffeeService asks for ['CoffeeRepository', 'FlavorRepository']
   │      'CoffeeRepository' is a useFactory entry that forFeature() made for you (note 09 §3.1b)
   ▼
 everything built once and cached → routes registered → app.listen()
```

One consequence worth knowing: an `async` factory is **awaited during startup**. That's why `TypeOrmModule.forRoot()` delays "Nest application successfully started" until the database connection is open. Its connection is a factory that returns a promise.

## 5. Functional vs class

The same wiring, both ways:

```js
// functional: you write the argument list AND the call
const coffeeService = makeCoffeeService(coffeeTable, flavorTable);
```

```ts
// class + Nest: you write the argument list; Nest writes the call
constructor(private readonly coffeeTable: CoffeeTable, private readonly flavorTable: FlavorTable) {}
```

**What the class version buys:** you never write the calls. Add an argument to a constructor and nothing else changes; Nest reads the new list next startup. And any entry can be swapped for a fake or a different class in one place, without touching the things that ask for it.

**What it costs:** the argument list is read through decorators and a compiler setting, so mistakes show up at startup as "can't resolve" rather than as a type error while you type. And anything that isn't a class needs a hand-written name (`@Inject`), which in the functional version was the normal case.

`useValue` / `useClass` / `useFactory` are a constant, a constructor call, and a function call. Nothing new was invented; things you already do were given names.

## 6. In my project

- `src/coffee/coffee.module.ts` `providers: [CoffeeService]` — the short form from step 3.
- `src/coffee/coffee.module.ts` `imports: [TypeOrmModule.forFeature([Coffee, Flavor])]` — two `useFactory` entries under string names, made for you. Note 09 §3.1b prints them: `{ provide: 'CoffeeRepository', inject: ['DataSource'] }`.
- `src/coffee/coffee.service.ts` constructor — `@InjectRepository(Coffee)` is step 5's `@Inject`, by another name.
- `src/user/user.module.ts` — `UserService` and `UserLoggerService` in one book, nothing exported, so no other module can ask for them.
- `src/main.ts` `app.useGlobalPipes(new ValidationPipe({...}))` — the one place we do the `new` ourselves, which is why nothing can be injected into it (note 05, quiz Q5).
- `src/coffee/coffee.controller.spec.ts` — step 4 in real life: `{ provide: CoffeeService, useValue: fakeCoffeeService }`.

Not built yet: `CoffeeRatingModule`, `COFFEE_BRANDS`, the `ConfigService` switch, the brands factory. That's the practice.

## 7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| Forget `exports` for something another module asks for | Startup error: *can't resolve … available in the X context* | you, at startup (the good kind of failure) |
| Put the same class in two modules' `providers` instead of exporting it | Two objects with separate state; no error at all | whoever reads a counter or cache that's silently split in two (note 03 Q2) |
| Ask for a non-class (`brands: string[]`) without `@Inject` | Nest looks up "Array" and fails at startup | you, after a confusing search |
| Typo in a raw string: `@Inject('COFEE_BRANDS')` | Startup error, only when that class is first built | you; the constants file exists to make this a compile error |
| `useValue` with one shared mutable object across tests | Test A changes it, test B sees the change | whoever debugs the flaky test |
| A factory that does slow work nobody needs at boot | Every restart waits for it | on-call, restarting during an incident |
| A factory that swallows its error and returns `undefined` | App starts "fine"; first request crashes on `undefined.method` | users, later, instead of you, now |
| `new SomeService()` inside another service | Skips the phone book: separate object, its own arguments not filled in, can't be faked in tests | whoever writes the test |

## 8. 🧠 Senior engineer lens

- **The phone book is the seam for tests.** Register a fake under the real name and the code under test never knows. This is the payoff for the whole mechanism.
- **Ask for the name, not the implementation.** Ask for `PaymentGateway`; register `StripeGateway` in production and `FakeGateway` in tests with `useClass`. Changing vendors becomes one line in one module.
- **`useFactory` is where config meets code.** "Read the environment, check it, build the client" belongs in one factory, so the rest of the app receives a finished object and never touches `process.env` (note 15).
- **Fail at startup, not at request time.** A missing name is caught before any user arrives. Design for that: validate config in the factory, connect to the database in the factory, throw if either is wrong.
- **Startup has a cost.** Every factory runs on every boot. Keep them quick, especially where the app restarts often.
- **A string name is a public contract.** Other modules depend on it. Rename it the way you'd rename a public function.

## 9. 🔗 Connects to
- [03 — Modules, Controllers, Providers & DI](03-modules-controllers-providers-di.md): the first pass, including `Type<any>`, the four keys of `@Module`, and the startup order
- [02 — Classes](02-js-classes-objects-this.md): why the constructor's parameters end up on `this`
- [09 — Database, Docker & TypeORM](09-database-docker-typeorm.md) §3.1b: `forFeature` printed as real `useFactory` entries
- [05 — Exception Filters](05-exception-filters.md) Q5, [06 — Interceptors](06-interceptors.md) Q6: why `new` in `main.ts` can't have injections
- 14 — Dynamic modules & scopes: `forRoot()` builds a book at runtime; request scope means a fresh book per request
- 15 — Configuration: `useFactory` plus env validation, done properly

## 10. ✍️ In my own words
> _(mine to write)_

## 11. 🛠️ Practice

Do these in order. Each one is one step from section 3, made real.

1. **Step 8, live.** `nest g mo coffee-rating`, `nest g s coffee-rating`, ask for `CoffeeService` in `CoffeeRatingService`'s constructor, start the app **without** exporting. Read the error out loud and find the `(?)` and the `index [0]`. Then add the export and start again.
2. **Step 4.** In `CoffeeModule`, replace `CoffeeService` with `{ provide: CoffeeService, useValue: { findAll: () => ['fake'] } }`. Hit `GET /coffee`. Put it back.
3. **Step 5.** Make `coffees.constants.ts` with `COFFEE_BRANDS`, register it with `useValue`, ask for it in `CoffeeService` with `@Inject`, and `console.log` it in the constructor. Then remove the `@Inject` and read that error too.
4. **Step 7.** Turn `COFFEE_BRANDS` into a `useFactory` that asks for `CoffeeService` through `inject` and builds the list from the database.
5. **Step 7b.** Make that factory `async` with a 2-second `setTimeout` inside. `console.log` in the factory *and* in `CoffeeService`'s constructor, then watch the order and when "successfully started" appears. Then make the factory throw instead: does the app start?

<details><summary>Hints</summary>

- 1: the error names the module ("in the CoffeeRatingModule context") and the argument position. Together they say which book and which constructor slot.
- 3: without `@Inject`, look in `dist/coffee/coffee.service.js` for `design:paramtypes` to see what Nest was given to look up.
- 4: `useFactory: async (coffeeService) => { const coffees = await coffeeService.findAll({}); return [...new Set(coffees.map(c => c.brand))]; }`, `inject: [CoffeeService]`.

</details>

## 12. ❓ Quiz

**Q1.** `providers: [CoffeeService]`. What is this short for, and what does Nest do with it?

- A) `{ provide: 'CoffeeService', useValue: new CoffeeService() }`; Nest stores the object
- B) `{ provide: CoffeeService, useClass: CoffeeService }`; Nest `new`s it once, filling the constructor's arguments from the book, and hands the same object to everyone who asks
- C) `{ provide: CoffeeService, useFactory: CoffeeService }`; Nest calls it as a function
- D) Nothing; the array is only documentation

<details><summary>Answer</summary>

**B.** Name and class are the same, so the pair is collapsed to one word. Every other form in this chapter is the un-collapsed pair with a different right-hand side.

</details>

**Q2.** `constructor(private readonly brands: string[])`, with `{ provide: 'COFFEE_BRANDS', useValue: [...] }` registered. What happens?

- A) Works: Nest matches by type
- B) Startup error. `string[]` compiles to `Array`, so Nest looks up a name called `Array` and finds nothing. Anything that isn't a class must be asked for with `@Inject('COFFEE_BRANDS')`
- C) `brands` is `undefined`
- D) Works only if the constant is exported

<details><summary>Answer</summary>

**B.** Types disappear when compiled; classes survive. A non-class name must be written by hand on both sides.

</details>

**Q3.** `CoffeeModule` has `CoffeeService` in `providers` and `exports`. `CoffeeRatingModule` imports `CoffeeModule` **and also** lists `CoffeeService` in its own `providers`. How many `CoffeeService` objects exist, and which one does `CoffeeRatingService` get?

- A) One; the import wins
- B) Two; `CoffeeRatingService` gets the one from its own book, which has separate state from the one the coffee controller uses
- C) Startup error: duplicate provider
- D) One; Nest merges them

<details><summary>Answer</summary>

**B.** A module's own entries win over imported ones. No error, and any state inside (a cache, a counter, an in-memory array) is now split in two.

</details>

**Q4.** A `useFactory` for a Redis client `await`s the connection. Redis is down. What happens at startup?

- A) The app starts and requests fail later
- B) Startup waits on the factory and fails with the connection error; the app never listens. That's intended: fail before serving anyone
- C) Nest retries forever
- D) The factory is skipped

<details><summary>Answer</summary>

**B.** Async factories are awaited during boot. If Redis is optional for your app, the factory should catch the error and return a do-nothing client on purpose, not by accident.

</details>

**Q5.** In a unit test you want `CoffeeController` to run against a fake service. Which form, and why does the controller not need changing?

- A) `useClass: CoffeeService` with a mocked database
- B) `{ provide: CoffeeService, useValue: fake }`: the controller only ever asks for the name `CoffeeService`; what sits behind the name is the test's decision
- C) Edit the controller to accept a flag
- D) `useFactory` returning the real service

<details><summary>Answer</summary>

**B.** This is the seam that makes the whole mechanism worth having. `src/coffee/coffee.controller.spec.ts` does exactly this.

</details>

**Q6.** `useClass` picks `ProductionConfigService` when `NODE_ENV === 'production'`, else `DevelopmentConfigService`. In CI, `NODE_ENV=test`. Which class runs, and what's the senior fix?

- A) Production; the string isn't "development"
- B) Development, because the check only tests for "production"; the fix is to validate `NODE_ENV` against a known list at startup and fail on anything unexpected, instead of silently defaulting
- C) Startup error
- D) Both classes are built

<details><summary>Answer</summary>

**B.** Silent defaults are how a staging box ends up pointed at a production database. A startup failure is cheaper (note 15).

</details>
