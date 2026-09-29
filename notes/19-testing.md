# 19 — Testing

> 📍 **Where on the Big Map:** testing doesn't sit *on* the map, it **re-runs the map**. A unit test skips the whole HTTP column and calls a service directly. An end-to-end test walks the entire row — middleware → guard → interceptor → pipe → controller → service → repository → SQL → response — with a fake client instead of a browser.
> 📘 **Course:** videos 66 (Introduction to Jest) · 67 (Getting Started with Test Suites) · 68 (Adding Unit Tests) · 69 (Diving into e2e Tests) · 70 (Creating our First e2e Test) · 71 (Implementing e2e Test Logic)
> 🌿 **Branch:** `config`
> 📚 **Docs:** [Nest — Testing](https://docs.nestjs.com/fundamentals/testing) · [Jest — Getting started](https://jestjs.io/docs/getting-started) · [Jest — expect](https://jestjs.io/docs/expect) · [supertest](https://github.com/ladjs/supertest)

The six videos are a tour of the syntax: here is `describe`, here is `it`, here is `beforeEach`, here is `Test.createTestingModule`, here is `supertest`. Every one of those is a thing you can look up in ninety seconds. The half that is missing — and the half that decides whether tests are worth the hours you put into them — is:

- **Which requirement makes you write a test at all?** Not "testing is good practice". An actual sentence from an actual week.
- **What do you assert, and what do you deliberately leave alone?** A test that pins down the wrong thing costs more than no test.
- **What does a test prove, and what can it never prove?** This one is measured below, with a green suite sitting on top of broken code.

So this note starts from two requirements, and everything is built to answer them.

---

# Part A — Unit tests

## 1. The problem

Two sentences, both of which have been true in this repo in the last two weeks.

**The first one.** `CoffeeService.findOrCreateFlavor` (`src/coffee/coffee.service.ts:68`) is nine lines long and it is called from two places: `create()` and `updateById()`. Say you decide to speed it up — it does a `findOne` per flavor name, and you notice that a coffee with five flavors makes five round trips to Postgres. You rewrite it. Now:

> **I changed `findOrCreateFlavor` and I don't know if I broke `createCoffee`.**

**The second one, from the other direction.** `findById` throws `NotFoundException` when a row is missing, and the frontend has code that depends on the 404 (note 05). Somebody is going to refactor that method one day. So:

> **CI must refuse a pull request that breaks the 404 behaviour.**

Here is what you do today, and it's not wrong, it just doesn't scale. You start the app, open Insomnia, and click:

```
POST /coffee   { "name": "Latte",      "brand": "Sbux", "flavor": ["vanilla"] }   → looks fine, 201
POST /coffee   { "name": "Flat White", "brand": "Sbux", "flavor": ["vanilla"] }   → looks fine, 201
```

Two green requests, so the change is fine. Except it isn't, and this note proves it with real output in §3.7 and in Part B §3.5: those two requests can leave **two** rows in the `flavor` table where there should be one, and nothing in either response says so.

Three things are wrong with clicking through by hand, and only the first is obvious:

1. **It's manual, so it happens once.** You check the thing you just changed. You do not re-check the other thirty endpoints, and neither does anybody reviewing your pull request.
2. **You only ever click the happy path.** Nobody opens Insomnia and carefully types `GET /coffee/999999` and `POST /coffee` with a missing `brand` and `?limit=abc`. The error paths are exactly where the real bugs live, and they are exactly what hand-testing skips.
3. **Nothing you did is repeatable by a machine.** "CI must refuse a pull request that breaks the 404" cannot be satisfied by a human with Insomnia. A pull request is checked by a program, at 3am, when you're asleep, on a branch you've never seen.

That third point is the actual definition of what we're building. **A test is the click-through, written down, so a machine can do it a thousand times and shout when the answer changes.** Everything else in this note is detail.

📚 [Jest — Getting started](https://jestjs.io/docs/getting-started)

## 2. Mental model

You already write tests. You just throw them away afterwards.

```
  what you do now                          what a test file is
  ─────────────────────────────────────    ──────────────────────────────────────
  start the app                            build the service with fake parts
  open Insomnia                            call the method directly
  look at the JSON with your eyes    ───►  compare it with `expect(...)`
  think "yeah that's right"                the machine thinks it, in 0.4ms
  close the tab, forget                    the file stays in git, forever
```

The React comparison is closer than it looks. When you change a component you save the file, look at the browser, and decide whether it looks right. That is an assertion — it's just stored in your head and it evaporates when you close the tab. A test moves that judgement out of your head and into a file, where it runs again next week for a change you haven't thought of yet.

And one word up front, because the videos use three words for the same thing and never say so. **A "mock", a "stub", a "fake", a "test double" — all of them mean: a stand-in object that has the same shape as the real thing but does something simple and predictable instead.** A pretend Postgres. A pretend service. When this note says *fake*, that's what it means.

## 3. Baby steps

### 3.1 Step 1 — No Jest at all: call the thing and look at it

Before any framework, the honest first move. Build the service by hand with fake parts, call it, print what comes back. `dist/` already holds the compiled JavaScript, so this is a plain Node script:

```js
// scratch/eyeball.cjs — throwaway, not in the repo
require('reflect-metadata');
const { CoffeeService } = require('./dist/coffee/coffee.service');

// A pretend coffee table. Two functions, no database, no Docker.
const fakeCoffeeTable = {
  findOne: async ({ where }) => (where.id === 1 ? { id: 1, name: 'Latte', brand: 'Sbux' } : null),
  create: (obj) => obj,
  save: async (obj) => ({ id: 42, ...obj }),
};
const fakeFlavorTable = { findOne: async () => null, create: (obj) => obj };

const service = new CoffeeService(fakeCoffeeTable, fakeFlavorTable);   // ← just `new`

(async () => {
  console.log('findById(1)   ->', await service.findById(1));
  try { await service.findById(999); }
  catch (e) { console.log('findById(999) ->', e.constructor.name, JSON.stringify(e.getResponse())); }
  console.log('create(...)   ->', await service.create({ name: 'Flat White', brand: 'Sbux', flavor: ['vanilla'] }));
})();
```

Real output, 2026-09-29:

```
findById(1)   -> { id: 1, name: 'Latte', brand: 'Sbux' }
findById(999) -> NotFoundException {"message":"Coffee #999 not found","error":"Not Found","statusCode":404}
create(...)   -> {
  id: 42,
  name: 'Flat White',
  brand: 'Sbux',
  flavor: [ { name: 'vanilla' } ]
}
```

**Stop and notice what just happened, because it is the single most important line in this note.** No Docker. No Postgres. No Nest. No `NestFactory`. The service ran, all three methods worked, and the 404 path fired — in about 80 milliseconds, on a laptop with no network. That was possible because of one decision made back in note 13: `CoffeeService` **asks for** its table helpers in the constructor instead of building them itself. If line 43 of `coffee.service.ts` had been `private repo = new Repository(...)` instead, none of this would be possible and the rest of this note would not exist.

That's what people mean when they say "dependency injection makes code testable", and it's worth saying in plain words: **a class that receives its collaborators can be handed pretend ones; a class that creates its own collaborators can only ever run against the real thing.** (Note 13 §1 is the long version.)

**What's still wrong:** your eyes. You ran it, you read three lines, you decided they were right. Next week you run it again and read the three lines again. The machine did none of the judging.

### 3.2 Step 2 — Turn the eyes into an `if`

The only difference between "looking at output" and "a test" is that the comparison is written down:

```js
const coffee = await service.findById(1);
if (coffee.name !== 'Latte') {
  throw new Error(`expected Latte, got ${coffee.name}`);
}
```

That is a test. Genuinely. A test framework is that `if`, plus book-keeping so that one failure doesn't stop the other ninety-nine, plus a nicer failure message. Written with Jest:

```ts
it('findById returns the coffee when it exists', async () => {
  const coffee = await service.findById(1);
  expect(coffee).toEqual({ id: 1, name: 'Latte', brand: 'Sbux' });
});
```

`it(...)` registers a function under a name. `expect(x).toEqual(y)` is the `if` plus the throw. `describe(...)` groups a file's tests under a heading so the terminal output is readable. Nothing more mysterious than that is going on — §4 writes the whole thing in fifteen lines of plain JS.

Jest's real contribution is what a failure *looks like*. Here is the same assertion, deliberately wrong, run for real (2026-09-29):

```
  ● CoffeeService › DELIBERATELY WRONG: create should save

    expect(received).resolves.toEqual(expected) // deep equality

    - Expected  - 2
    + Received  + 2

      Object {
        "brand": "Sbux",
    -   "id": 2,
    -   "name": "Flat White",
    +   "id": 1,
    +   "name": "Latte",
      }

      44 |     fakeCoffeeRepo.create.mockReturnValue(dto as never);
      45 |     fakeCoffeeRepo.save.mockResolvedValue({ id: 1, ...dto } as never);
    > 46 |     await expect(service.create(dto)).resolves.toEqual({ id: 2, name: 'Flat White', brand: 'Sbux' });
         |                                                ^
```

Minus is what you asked for, plus is what you got, and the source line is printed with an arrow. That diff is most of why people use a test framework instead of hand-rolled `if`s.

📚 [Jest — expect](https://jestjs.io/docs/expect)

### 3.3 Step 3 — The dependency problem

Step 1 worked because I hand-built the fakes and called `new CoffeeService(a, b)` myself. That's fine for one service with two dependencies. It stops being fine the moment a service's constructor grows, or the class you want to test is a controller whose service has a service of its own.

And the obvious alternative — "just give it the real repository" — is worse than it looks:

| Giving a unit test the real database | What it costs |
|---|---|
| Needs Docker running | The test fails on a machine where `docker compose up -d` wasn't run, which includes every CI machine until somebody configures it |
| Needs a connection, a pool, a schema | Startup goes from 80ms to several seconds, per test file |
| **Every test shares the same rows** | Test A inserts a coffee, test B counts coffees and gets the wrong number. They pass alone and fail together |
| Tests write to the data you're developing against | This repo's dev database currently holds 4 coffees and 1 flavor. A test that truncates tables deletes them |
| It's slow, so you stop running it | The test suite you don't run on every save is a test suite that doesn't catch anything |

The third row is the one that ruins people's week, and it has a name later in this note: **shared state**.

So: fakes. But now the wiring problem is back — who assembles the object?

### 3.4 Step 4 — `Test.createTestingModule`: the container, but you supply the phone book

In production, `NestFactory.create(AppModule)` reads your modules and builds every object, filling each constructor from the list of providers (note 03, note 13). `Test.createTestingModule` is **the same container with a smaller phone book that you write by hand**:

```ts
const module: TestingModule = await Test.createTestingModule({
  providers: [
    CoffeeService,                                              // the real thing under test
    { provide: getRepositoryToken(Coffee), useValue: fakeRepo },  // a pretend coffee table
  ],
}).compile();

service = module.get<CoffeeService>(CoffeeService);
```

Three pieces, and you have met all three before:

- The object passed to `createTestingModule` is **the same metadata object** you put inside `@Module({...})` — `providers`, `controllers`, `imports`. Same shape, same rules.
- `{ provide: X, useValue: y }` is the custom provider from note 13 §3 step 4: *"when anyone asks for the name `X`, hand them `y` and don't build anything"*. This is the hook the whole of unit testing hangs on.
- `getRepositoryToken(Coffee)` is the **name** that `@InjectRepository(Coffee)` asks for. TypeORM's `forFeature([Coffee])` registers the real table helper under the string `"CoffeeRepository"`, and `getRepositoryToken(Coffee)` computes that same string. Without it you'd be writing the magic string yourself and getting it wrong.
- `.compile()` builds the objects (it's the `NestFactory.create` of the test world), and `.get(Class)` pulls one out.

**What breaks if you leave a dependency out**, and this is the error the videos hit and the error that is *currently live in this repo* — real output from `pnpm test`, 2026-09-29:

```
FAIL src/coffee/coffee.service.spec.ts
  ● CoffeeService › should be defined

    Nest can't resolve dependencies of the CoffeeService (CoffeeRepository, ?).
    Please make sure that the argument "FlavorRepository" at index [1] is
    available in the RootTestModule module.

    Potential solutions:
    - Is RootTestModule a valid NestJS module?
    - If "FlavorRepository" is a provider, is it part of the current RootTestModule?
    ...
      29 |     // getRepositoryToken(Coffee) is the name that helper is registered under
      30 |     // ("CoffeeRepository"), the same name @InjectRepository(Coffee) asks for.
    > 31 |     const module: TestingModule = await Test.createTestingModule({
```

Read the message properly: **`(CoffeeRepository, ?)`**. Nest is showing you the constructor's argument list with a question mark where it got stuck. Argument 0 it found; argument 1, `FlavorRepository`, nobody provided. `src/coffee/coffee.service.spec.ts:31` lists a fake for `Coffee` and not for `Flavor` — the second repository was added to the constructor when many-to-many flavors arrived, and the spec was never updated.

The rule, and it has no exceptions: **a test module must provide every dependency of everything it builds, real or fake.** There is no partial mode. The container either has a full phone book or it refuses to build the object.

⚠️ This is not a made-up teaching example. It is the state of `main` right now, and it is why `pnpm test` in this repo does not go green. §6 has the numbers.

📚 [Nest — Testing utilities](https://docs.nestjs.com/fundamentals/testing)

### 3.5 Step 5 — `jest.fn()`: a fake that remembers

A plain object literal is enough for a fake that always answers the same thing. What it can't do is tell you *what it was asked*. `jest.fn()` is a function that records every call and lets you script its answer:

```ts
const fakeRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };

fakeRepo.findOne.mockResolvedValue({ id: 1, name: 'Latte' });   // "when asked, resolve with this"
await service.findById(1);
expect(fakeRepo.findOne).toHaveBeenCalledWith({ where: { id: 1 } });   // "…and it was asked like this"
```

Written by hand it's about six lines, which is worth seeing once so the magic goes away:

```js
function fn(impl = () => undefined) {
  const spy = (...args) => { spy.calls.push(args); return spy.value ?? impl(...args); };
  spy.calls = [];
  spy.mockReturnValue = (v) => { spy.value = v; return spy; };
  return spy;
}
```

`mockReturnValue` for a plain value, `mockResolvedValue` for a promise (the repository's methods are `async`, so that's the one you want for `findOne` / `save`).

⚠️ **The ESM trap, and it bit this repo hard.** Nest 12 ships ES-module-only packages, this machine is on Node 22, and Jest could not `require()` them. The fix was to run Jest in ES-module mode, and the price is that `jest` is **no longer a global**. Every spec that uses `jest.fn()` must import it. Leave the import out and you get, verified 2026-09-29:

```
  ● jest.fn() without the import, in ESM mode › blows up

    ReferenceError: jest is not defined

      4 | describe('jest.fn() without the import, in ESM mode', () => {
      5 |   it('blows up', () => {
    > 6 |     const spy = jest.fn();
        |                 ^
```

So every spec in this repo that fakes anything opens with:

```ts
import { jest } from '@jest/globals';
```

And if you ever run Jest without the `--experimental-vm-modules` flag that `package.json:test` supplies, you get the *other* error — the one that existed before the config was fixed (verified 2026-09-29):

```
  ● Test suite failed to run

    Must use import to load ES Module: .../node_modules/@nestjs/common/index.js

    The file contains ESM syntax (import/export) that could not be executed as CommonJS. Either:
      - Configure a transform (e.g. babel-jest) that compiles this file to CommonJS
      - If the file is in "node_modules", allow it to be transformed by adjusting "transformIgnorePatterns"
      - Use Node v24.9+ where Jest supports require(esm) natively
```

`jest.config.ts:20-31` is the fix: `extensionsToTreatAsEsm: ['.ts']`, `ts-jest` with `useESM: true`, and a tsconfig override forcing `module: 'esnext'` because the repo's own `tsconfig.json` says `nodenext`, which compiles to CommonJS here. Three settings and an import, and none of it is in the course, because the course was recorded on an older Nest.

📚 [Jest — Mock functions](https://jestjs.io/docs/mock-functions) · [Jest — ECMAScript modules](https://jestjs.io/docs/ecmascript-modules)

### 3.6 Step 6 — Test the error path, because that's where the bugs are

The requirement was *"CI must refuse a pull request that breaks the 404 behaviour"*. That is not a test of `findById` working. It is a test of `findById` **failing correctly**, and it's the test people skip.

The naive attempt doesn't work, and it's worth seeing why:

```ts
it('throws when missing', async () => {
  fakeRepo.findOne.mockResolvedValue(null);
  const coffee = await service.findById(999);      // ← this line throws
  expect(coffee).toBeUndefined();                  // ← never runs
});
```

The test fails, which looks like success ("it noticed!"), but it fails for the wrong reason — an unhandled rejection — and it would also fail if the method threw the *wrong* error. The shape you want says "I expect this to reject, and with this kind of error":

```ts
it('findById throws 404 when the row is missing', async () => {
  fakeRepo.findOne.mockResolvedValue(null as never);
  await expect(service.findById(999)).rejects.toThrow(NotFoundException);
});
```

Three details that matter:

- `.rejects` unwraps the promise and asserts on what it rejected with. For a synchronous throw it's `expect(() => fn()).toThrow(...)` — note the arrow function, because `expect(fn())` would run it and throw before `expect` ever sees it. `src/user/user.service.spec.ts:40` is the synchronous form; `src/coffee/coffee.service.spec.ts:58` is the async one.
- `await` in front of `expect(...).rejects` is not optional. Forget it and the assertion resolves after the test has already finished, and the test passes no matter what.
- **Assert on the error class, not the message.** `toThrow(NotFoundException)` survives somebody improving the wording. `toThrow('Coffee #999 not found')` does not — and the failure it produces when the wording changes is this (real output, 2026-09-29):

```
  ● CoffeeService › DELIBERATELY WRONG: expects the wrong message

    expect(received).rejects.toThrow(expected)

    Expected substring: "Coffee 999 does not exist"
    Received message:   "Coffee #999 not found"

          122 |     if (!coffee) {
        > 123 |       throw new NotFoundException(`Coffee #${id} not found`);
              |             ^
```

That is a test failing while the application is perfectly correct. Do it a few times and the team learns to ignore red builds, which is much more expensive than the bug you were trying to catch. **The class is the contract — the 404 the frontend depends on. The exact English is not.**

### 3.7 Step 7 — What a senior does

Four habits, each of which exists because somebody got burned.

**(a) Test the behaviour, not the wiring.** Look at these two assertions on the same method:

```ts
expect(fakeRepo.create).toHaveBeenCalledWith(dto);   // "it called create() then save()"
await expect(service.create(dto)).resolves.toEqual({ id: 1, ...dto });   // "it gives back the saved coffee"
```

The second one is a promise to the caller: hand me a DTO, get back the stored coffee with an id. That promise should hold in a year. The first one is a description of today's *implementation* — and the day somebody replaces `create()` + `save()` with a single `insert()`, or wraps it in a transaction (note 11), the behaviour is identical and the test goes red anyway. A test you have to edit every time you tidy code is a test that punishes tidying.

The honest exception: assert on a call when **the call itself is the behaviour**. "Deleting a coffee must actually delete it", "the payment provider must be charged exactly once", "the email must be sent" — there is no return value to check, so the call is the contract. `src/coffee/coffee.service.spec.ts:50` (`expect(fakeRepo.findOne).toHaveBeenCalledWith({ where: { id: 1 } })`) sits on the wrong side of this line, and is a reasonable thing to delete.

**(b) Reset the fakes between tests, or you get the worst kind of failure.** The fakes in this repo are created once, at the top of the `describe`, and shared by every test in the file. That means a call counter set by test A is still there when test B runs. Verified, 2026-09-29 — the whole file:

```
  ● what a shared fake remembers › test B: the 404 path — passes alone, fails after A

    expect(jest.fn()).toHaveBeenCalledTimes(expected)

    Expected number of calls: 1
    Received number of calls: 2

    > 25 |     expect(fakeRepo.findOne).toHaveBeenCalledTimes(1);
```

And the same file, running **only** test B:

```
Test Suites: 1 passed, 1 total
Tests:       1 skipped, 1 passed, 2 total
```

A test that passes alone and fails in company is the definition of a bad afternoon: the failure message points at test B, the bug is in test A, and re-running "just that one test" to investigate makes it pass. One line prevents it, and every spec in this repo that uses fakes has it:

```ts
beforeEach(() => { jest.clearAllMocks(); });   // forget every recorded call and scripted answer
```

(`clearAllMocks` wipes calls and return values. `resetAllMocks` also removes any implementation you set. `restoreAllMocks` puts spied-on real methods back. `clearAllMocks` is the one you want nine times out of ten.)

📚 [Jest — Setup and teardown](https://jestjs.io/docs/setup-teardown)

**(c) Know what a heavily-mocked test cannot see.** This is the uncomfortable one, so here it is measured rather than asserted.

I took the scenario from §1 — someone "optimises" `findOrCreateFlavor` by removing the lookup, so it always creates a new flavor row instead of reusing the existing one:

```ts
// the "optimisation"
findOrCreateFlavor(name: string) {
  return this.flavorRepositery.create({ name });   // the findOne is gone
}
```

Then I ran perfectly ordinary unit tests against the broken service — `create` builds and saves, `findById` returns the coffee, with `jest.fn()` fakes for both repositories. Real output, 2026-09-29:

```
Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
```

**Green, on broken code.** Not because the tests were badly written — they're the same shape as the ones in this repo — but because the bug lives in the *conversation between the service and the database*, and in a unit test there is no database to have a conversation with. The fake flavor repository happily returns whatever it's told, forever.

That is the real answer to "how much should I mock": **every fake you install deletes a category of bug from the test's field of view.** Mock the repository and you stop testing SQL, constraints, cascades and uniqueness. Mock the service in a controller test and you stop testing business rules. Mock everything and the test proves only that your own code doesn't crash, which is worth something, but much less than people assume when they quote their coverage number.

Part B §3.5 runs the *same* broken code through an end-to-end test against a real Postgres, and it fails in one line. That's the argument for e2e, made with output instead of adjectives.

**(d) Write the test name as a sentence about behaviour.** `'findById throws 404 when the row is missing'` tells the next person what the system promises. `'should work'` tells them nothing, and `'test 3'` is worse. The names are printed in the terminal, so a test file read top to bottom is a specification of the class — which is the second job tests do, covered in §8.

**The names, once, in brackets.** A file of tests is a *test suite*; `it(...)` is a *test case*; the comparison is an *assertion*; the pretend objects are *test doubles* (mocks, stubs, fakes); the `beforeEach` part is *setup* or *arrange*, the call is *act*, the `expect` is *assert*.

## 4. How it works underneath

### 4.1 Jest, in fifteen lines

There is no magic in `describe` / `it` / `expect`. They collect closures into a tree and then walk it:

```js
const suites = [];
let current = { name: 'root', tests: [], before: [], children: [] };

function describe(name, fn) {
  const parent = current;
  current = { name, tests: [], before: [], children: [] };
  parent.children.push(current);
  fn();                       // running the body is what registers the its
  current = parent;
}
function it(name, fn)       { current.tests.push({ name, fn }); }
function beforeEach(fn)     { current.before.push(fn); }

function expect(received) {
  return {
    toEqual(expected) {
      if (JSON.stringify(received) !== JSON.stringify(expected))
        throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(received)}`);
    },
  };
}

async function run(node, inheritedBefore = []) {
  const before = [...inheritedBefore, ...node.before];
  for (const t of node.tests) {
    for (const b of before) await b();          // ← every beforeEach, outermost first
    try { await t.fn(); console.log('✓', t.name); }
    catch (e) { console.log('✕', t.name, '\n   ', e.message); }   // one failure doesn't stop the rest
  }
  for (const child of node.children) await run(child, before);
}
```

Two things fall straight out of that loop and answer questions people actually have:

- **`describe`'s body runs immediately, at import time**; the `it` bodies run later. So a variable assigned inside `beforeEach` is `undefined` while the `describe` body is executing — which is why every spec in this repo declares `let service: CoffeeService;` at the top and assigns it inside `beforeEach`, rather than assigning it directly.
- **`beforeEach` runs before *every* test, not once**, and nested `describe`s inherit the outer ones. That's the whole mechanism behind "a fresh testing module per test" in §3.4.

The pieces Jest adds on top: running each test *file* in its own worker process (so two files can't share module state), the pretty diff from §3.2, fake timers, coverage, and a watch mode that re-runs only what changed.

### 4.2 `Test.createTestingModule`, and where the fake gets in

```
 PRODUCTION                                TEST
 ──────────────────────────────            ────────────────────────────────────
 main.ts                                   coffee.service.spec.ts
   NestFactory.create(AppModule)             Test.createTestingModule({ providers: [...] })
        │                                         │
        ▼                                         ▼
   read @Module metadata                     read the metadata object YOU wrote
   walk imports → UserModule, CoffeeModule   (no imports at all — nothing else is built)
        │                                         │
        ▼                                         ▼
   phone book:                               phone book:
     CoffeeService      → new CoffeeService    CoffeeService        → new CoffeeService
     "CoffeeRepository" → real TypeORM repo    "CoffeeRepository"   → fakeRepo      ← useValue
     "FlavorRepository" → real TypeORM repo    "FlavorRepository"   → fakeFlavorRepo
     DataSource         → live pg pool         (absent → "can't resolve dependencies")
        │                                         │
        ▼                                         ▼
   app.listen(3000)                          module.get(CoffeeService)
```

The container is the same container. `useValue` is the same custom provider you already met. **The only thing testing adds to what you knew after note 13 is: you get to write the phone book by hand.** That's it. That's the whole "Nest testing utilities" idea.

One extra door, worth knowing it exists: when you *do* want the real module and only one thing swapped, `Test.createTestingModule({ imports: [CoffeeModule] }).overrideProvider(CoffeeService).useValue(fake).compile()` builds everything normally and replaces one entry. That's the tool for an e2e test that needs a real app but a fake payment provider.

## 5. Functional vs class

For once the functional version isn't a teaching device — for a lot of code it's the better answer.

**A factory function.** If `CoffeeService` were written the way you'd write it in React-land, it would be a function that closes over its dependencies:

```js
const makeCoffeeService = (coffeeRepo, flavorRepo) => ({
  findById: async (id) => {
    const coffee = await coffeeRepo.findOne({ where: { id } });
    if (!coffee) throw new NotFoundException(`Coffee #${id} not found`);
    return coffee;
  },
  create: async (dto) => { /* ... */ },
});

// the entire test setup:
const service = makeCoffeeService(fakeCoffeeRepo, fakeFlavorRepo);
```

**The class version, tested Nest's way:**

```ts
const module = await Test.createTestingModule({
  providers: [
    CoffeeService,
    { provide: getRepositoryToken(Coffee), useValue: fakeCoffeeRepo },
    { provide: getRepositoryToken(Flavor), useValue: fakeFlavorRepo },
  ],
}).compile();
const service = module.get(CoffeeService);
```

**What the Nest way buys:**

- **Names instead of positions.** `makeCoffeeService(fakeCoffeeRepo, fakeFlavorRepo)` depends on argument order; swap the two and the tests still compile and mislead you. The container matches by name (`"CoffeeRepository"`), so a swap is impossible and a missing one is a loud startup error instead of a silent `undefined` three calls later.
- **The same wiring as production.** The test resolves dependencies through the *actual* container, with the *actual* tokens, honouring the *actual* `@Inject` decorators. If the wiring is broken, the test breaks too — which is a feature. Note §3.4's failure is exactly that: the test caught a mismatch between the constructor and its registration.
- **It scales past two arguments.** A class with six dependencies, three of which are optional and one of which is request-scoped, is miserable to assemble by hand and trivial to assemble through the container.
- **In e2e it's not optional at all.** `createNestApplication()` gives you the real pipeline — guards, pipes, interceptors, filters, routing. You cannot hand-build that with a factory function, and Part B is entirely about why that matters.

**What it costs:**

- **Ceremony.** Six lines and an `await` to get an object you could have made with `new`. Every spec in this repo pays it.
- **It only works on things the container knows about.** A pure function has no place in it at all — and should not be forced into one.

**The rule that follows.** A fixture generator, a price calculator, a date formatter, a function that turns a DTO into an entity: these are pure functions, they need no Nest, no container and no `beforeEach`. Import them and call them.

```ts
// no Test.createTestingModule, no providers, no async — and there shouldn't be
import { makeCoffee } from './fixtures';
it('makeCoffee fills in a brand by default', () => {
  expect(makeCoffee({ name: 'Latte' })).toEqual({ name: 'Latte', brand: 'Sbux', flavor: [] });
});
```

Reach for `Test.createTestingModule` when the thing under test **has injected dependencies**. Otherwise don't. Wrapping a pure function in a testing module is pure cost.

## 6. In my project

**The command, and what it actually reports today.** `pnpm test` (2026-09-29):

```
FAIL src/coffee/coffee.service.spec.ts

Test Suites: 1 failed, 6 passed, 7 total
Tests:       4 failed, 11 passed, 15 total
Snapshots:   0 total
Time:        1.915 s
Ran all test suites.
```

Seven spec files, fifteen tests, and **the suite is red**. All four failures are the one cause from §3.4: `src/coffee/coffee.service.spec.ts:31` builds a testing module with a fake for `getRepositoryToken(Coffee)` but none for `getRepositoryToken(Flavor)`, while `src/coffee/coffee.service.ts:43-49` asks for both. Adding

```ts
{ provide: getRepositoryToken(Flavor), useValue: fakeFlavorRepo },
```

fixes all four — verified in a scratch copy, where the same file with the flavor repository provided goes green.

**The files, and what each is worth:**

| File | What's in it | Verdict |
|---|---|---|
| `src/coffee/coffee.service.spec.ts` | 4 tests: defined, findById happy, findById 404 (`rejects.toThrow(NotFoundException)`, line 58), create builds-then-saves | the real work; currently failing on the missing `FlavorRepository` |
| `src/coffee/coffee.controller.spec.ts` | 2 tests; fake `CoffeeService` via `useValue` (line 22), asserts the body is handed over unchanged (line 35) | a thin but honest controller test |
| `src/user/user.service.spec.ts` | 4 tests, including `createUser` refusing to store `isAdmin` (line 28) and a synchronous `expect(() => ...).toThrow(NotFoundException)` (line 41) | the `isAdmin` one is the best test in the repo: it pins down a security behaviour (note 07 §6) |
| `src/user/user.controller.spec.ts` | 2 tests; comment at line 22 records the exact `"can't resolve dependencies of UserController (?)"` error the generated spec threw | good |
| `src/utils/transform.interceptor.spec.ts` | 1 test: `expect(new TransformInterceptor()).toBeDefined()` | **proves nothing.** It asserts that `new` returns an object. It would pass if `intercept()` were deleted |
| `src/guards/guard-role.guard.spec.ts` | 1 test, same shape | same; and the guard itself is an empty stub (note 16 §6) |
| `src/app.controller.spec.ts` | 1 test: `getHello()` returns `'Hello World!'`, with the **real** `AppService` in `providers` (line 11) | the one spec with no fakes at all — worth noticing that a test with no dependencies to fake doesn't need any |

**The `should be defined` tests.** Five of the fifteen are `expect(x).toBeDefined()`. The CLI generates them so a new file isn't empty, and while a constructor has dependencies they do serve one purpose: they fail loudly when the wiring is wrong (which is precisely what is happening in `coffee.service.spec.ts` right now). Once a file has real tests, those real tests would fail on broken wiring too, and the `toBeDefined` line stops earning its place.

**Config, and the history behind it:**

- `package.json:16` — `"test": "node --experimental-vm-modules ./node_modules/jest/bin/jest.js"`. The flag is not decoration; without it you get the `Must use import to load ES Module` error from §3.5.
- `jest.config.ts:20` — `extensionsToTreatAsEsm: ['.ts']`, with the comment explaining that Nest 12 packages are ES-module-only and Node here is 22.
- `jest.config.ts:21-31` — `ts-jest` with `useESM: true` plus an inline `tsconfig: { module: 'esnext', moduleResolution: 'bundler' }`, because the repo's own `tsconfig.json` says `nodenext`, which compiles to CommonJS in a package with no `"type": "module"`.
- `jest.config.ts:16` — `testRegex: '.*\\.spec\\.ts$'`. That pattern needs a literal **dot** before `spec`, and `app.e2e-spec.ts` has a hyphen there, so `pnpm test` never picks the e2e file up. The e2e run has its own config at `test/jest-e2e.json` with `testRegex: ".e2e-spec.ts$"`. Two configs, two non-overlapping sets of files, one naming convention doing the separating — which is why the course is strict about `.spec.ts` versus `.e2e-spec.ts`.
- Every spec that uses `jest.fn()` opens with `import { jest } from '@jest/globals';` — `coffee.service.spec.ts:2`, `coffee.controller.spec.ts:2`, `user.service.spec.ts:2`, `user.controller.spec.ts:2`. This is written down in `AGENTS.md` as a repo rule.

**Not covered by any test right now:** `CoffeeService.findOrCreateFlavor` (the method from §1), `updateById`, `deleteById`, `findAll` and its pagination, and the whole of `TransformInterceptor.intercept`. Four of those are in §11.

## 7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| Assert on **how** the method did it (`create` was called, then `save`) instead of **what** it returned | Every refactor that keeps the behaviour identical turns the suite red. Replacing two repository calls with one `insert`, or wrapping them in a transaction (note 11), breaks tests while breaking nothing | whoever tries to improve the code, learns that tidying costs an hour of test edits, and stops tidying |
| Fake everything, then quote the coverage number | The test exercises only your own code talking to your own pretend objects. **Verified 2026-09-29:** `findOrCreateFlavor` with the lookup removed still gives `Tests: 2 passed, 2 total`, while the same code against a real Postgres duplicates flavor rows (Part B §3.5) | the user who gets six identical "vanilla" rows, and you, holding a green build and a bug report |
| No `jest.clearAllMocks()` in `beforeEach` | Call counts and scripted return values leak from one test into the next. **Verified:** the same file gives `1 failed, 1 passed` in full and `1 passed` when only that test runs | whoever debugs it, because the failure names test B and the cause is in test A, and re-running B alone makes it pass |
| Assert on the exact error message (`toThrow('Coffee #999 not found')`) | Improving the wording turns the build red although the API is correct: `Expected substring: "Coffee 999 does not exist" / Received message: "Coffee #999 not found"` | the team, who learn that red doesn't mean broken and start clicking merge anyway — which is how a real failure gets through |
| Aim for 100% line coverage | You end up writing tests for getters, constructors and `toBeDefined`, all of which run lines and prove nothing. Coverage measures what *ran*, never what was *checked* — a suite with no `expect` at all can hit 100% | the next person, who trusts the badge; and everyone's build time |
| Test only the happy path | The happy path is the one you already clicked through by hand. The 404, the empty list, the duplicate name, the negative `?limit`, the concurrent write — none of them have ever been run | the user who hits the edge case in production, and the on-call engineer at 3am with no test to reproduce it |
| Skip the error-path test because "it obviously throws" | `findById` is four lines and the `if (!coffee)` is trivially correct today. Six months later somebody adds caching above it and the cache returns `undefined` on a miss, so the 404 quietly becomes a 200 with an empty body | the frontend, whose "not found" screen never shows; and the support team explaining a blank page |
| Give a unit test a real database connection | Needs Docker, adds seconds per file, and every test shares the same rows, so they pass alone and fail together | everyone on CI, and your dev data the first time a test truncates a table |

## 8. 🧠 Senior engineer lens

- **The test pyramid, honestly.** The usual picture is lots of fast unit tests at the bottom, fewer integration tests, a handful of end-to-end tests at the top, and the reasoning is cost: unit tests are milliseconds and pinpoint the broken function; e2e tests are seconds, need a database, and tell you "something in this chain is wrong". The part the picture leaves out is that **the bugs are not distributed like the pyramid.** In a CRUD service like this one, most real defects live in the joins between things — the SQL, the transaction boundary, the validation pipe that wasn't bound, the cascade that didn't fire — and those are precisely the bugs unit tests are blind to, as §3.7(c) measured. So: keep the shape, but don't let the shape talk you out of the handful of e2e tests that cover your critical paths. A service with four hundred unit tests and no e2e test can be completely broken and completely green.
- **Tests are the documentation that can't go stale.** `'createUser stores only name and email, never extra fields'` (`src/user/user.service.spec.ts:28`) is a statement about what the system promises, and unlike a comment or a wiki page, it fails when it stops being true. When you join a codebase, the spec files are the fastest honest description of what it does. Write the names as sentences for that reason.
- **Flaky tests are worse than no tests.** A test that fails one run in twenty trains the team to re-run the build instead of reading it, and once that habit exists your real failures are invisible too. The usual causes, in order: shared state between tests (§3.7(b)), real time (`Date.now()`, `setTimeout`, anything involving "today"), test order dependence, unawaited promises, and shared external resources like one database for parallel workers. Fix a flake or delete it; never leave it.
- **What to test, stated as a rule you can apply.** Test the things you would be embarrassed to break: money, permissions, data loss, the error contracts other people's code depends on. Test every `if` that encodes a business rule. Don't test the framework (Nest's routing works), don't test the language, don't test a getter, and don't test a private method — if a private method needs its own test, it's probably a public function on something else. `findOrCreateFlavor` is `private` and deserves testing, which is a hint it wants to be a `FlavorService`.
- **Tests are a design tool, and this is the one people discover last.** "Hard to test" is almost never a testing problem. A class that needs eight fakes has eight dependencies and is doing too much. A method you can't test without a database has business logic tangled with data access. A function you can't call without booting the app is reaching for globals. The friction is information: note 13's dependency injection is what makes this repo testable at all, and §3.1 is the proof.
- **What this looks like in CI.** `pnpm test` on every push, `pnpm test:e2e` on every pull request (with a database service container), both required before merge. That is what makes the original requirement — *"CI must refuse a pull request that breaks the 404 behaviour"* — real; until the check is required, it's a suggestion. And a suite that is red on `main` teaches everyone to ignore it, which is worth remembering while this repo's own suite reports `1 failed, 6 passed`.
- **This transfers.** `describe`/`it`/`expect` is Jasmine's shape, and it is also Mocha, Vitest, Jest, RSpec and pytest with different spelling. Arrange–act–assert, test doubles, fixtures, the pyramid: none of it is JavaScript-specific. Learn it once.

## 9. 🔗 Connects to

- [13 — Custom providers](13-custom-providers.md) — the whole of unit testing is `{ provide: X, useValue: fake }`, and §3.1 here is the payoff for a class asking for its dependencies instead of building them
- [03 — Modules, Controllers, Providers & DI](03-modules-controllers-providers-di.md) — `Test.createTestingModule` takes the same metadata object as `@Module`
- [05 — Exception filters](05-exception-filters.md) — the `NotFoundException` the 404 test pins down, and why the class matters more than the message
- [07 — Pipes & validation](07-pipes-validation.md) — `ValidationPipe` is bound in `main.ts`, which is exactly why Part B's e2e test has to re-bind it
- [16 — Building blocks and binding](16-building-blocks-and-binding.md) — what an e2e test does and doesn't include depends entirely on what's bound where
- [11 — Transactions](11-transactions.md) — the refactor that breaks implementation-detail tests while breaking no behaviour
- Part B below — what unit tests structurally cannot see

## 10. ✍️ In my own words
> _(mine to write)_

## 11. 🛠️ Practice (Part A)

1. **Make the suite green.** `pnpm test` currently reports `Tests: 4 failed, 11 passed`. Fix `src/coffee/coffee.service.spec.ts` so all fifteen pass, without touching `src/coffee/coffee.service.ts`.

   <details><summary>Hints</summary>

   - Read the error message's first line properly: `(CoffeeRepository, ?)`. The `?` is the constructor argument Nest couldn't fill, and the sentence after it names it.
   - Compare the `providers` array at `coffee.service.spec.ts:32` with the constructor at `coffee.service.ts:43`. Count the entries in each.
   - The token for the second one is built the same way as the first, with a different entity class.
   - Which methods does the fake need? Only the ones the code paths under test actually call — you can start with an empty object and let the failure tell you.
   </details>

2. **Test `findOrCreateFlavor` — the method from §1.** It's `private`, which is the first interesting part of this task. Write tests for both branches: the flavor already exists (reuse the row, no `create` call), and it doesn't (build a new one). Then convince yourself whether you've actually tested the thing you care about.

   <details><summary>Hints</summary>

   - `private` in TypeScript is a compile-time check, not a runtime one — the method exists on the object at runtime. Decide whether to reach it through a cast, or to test it **through** `create()`, which is what actually calls it. The second is the better instinct and §3.7(a) says why.
   - The two branches differ by what `flavorRepo.findOne` answers: a row, or `null`. That's one `mockResolvedValue` each.
   - For the "already exists" branch, the interesting assertion is what *didn't* happen: `expect(fakeFlavorRepo.create).not.toHaveBeenCalled()`.
   - Now the honest question: if you break the method the way §3.7(c) does, does your test go red? If not, you've tested the fake, not the behaviour — which is the whole point of Part B.
   </details>

3. **Pin the 404 contract for every route that has one.** `findById`, `updateById` and `deleteById` all throw `NotFoundException`. Only one is tested. Add the other two.

   <details><summary>Hints</summary>

   - `updateById` doesn't use `findOne` to decide — read `coffee.service.ts:153` and work out which repository method has to answer "missing" for the `if` to fire, and what value counts as missing.
   - `deleteById` calls `findOne` first, so it's the same shape as the existing test.
   - Assert on the class, not the message (§3.6).
   </details>

4. **Test the pagination DTO without any Nest at all.** `src/common/dto/pagination-query.dto.ts` is a class with `@IsPositive`, `@IsOptional` and `@Type(() => Number)`. Write a spec that proves `?limit=abc` is rejected and `?limit=10` becomes the **number** 10, not the string.

   <details><summary>Hints</summary>

   - No `Test.createTestingModule` here: this is §5's "pure thing, no container" case. You need two functions from the libraries the DTO already imports — one that turns a plain object into a class instance, and one that runs the rules on it.
   - The transform and the validation are two separate steps, in that order (the comment at `pagination-query.dto.ts:28` says why).
   - Assert on the *type* as well as the value: `toBe(10)` passes for `10` and fails for `'10'`, which is exactly the bug you're guarding against.
   - Bonus: `?limit=0` and `?limit=-1`. Read `@IsPositive` carefully and decide which of those should be rejected before you run it.
   </details>

5. **Make a test lie to you, on purpose.** Take the passing `create builds the object first, then saves it` test. Now break `CoffeeService.create` — have it return `null` after saving. Does the test fail? Now break it a different way: leave the return value alone but stop passing `flavor` into `repo.create`. Does the test fail? Write down in one sentence what that second result tells you about what the test is actually watching.

6. **Give `TransformInterceptor` a real test.** `src/utils/transform.interceptor.spec.ts` currently only checks that `new` works. Make it assert the envelope: `{ statusCode, data, success: true }`.

   <details><summary>Hints</summary>

   - `intercept(context, next)` needs two fakes. `next` is the easy one: an object with a `handle()` that returns an Observable — `of(value)` from `rxjs` builds one in a single call.
   - `context` only needs the parts the interceptor touches. Read `transform.interceptor.ts:21` and build exactly that chain of objects and nothing more.
   - The return value is an Observable, not a value. `firstValueFrom` from `rxjs` turns it into a promise you can `await`.
   </details>

## 12. ❓ Quiz (Part A)

**Q1.** Your `CoffeeService` unit tests are all green. A colleague removes the `findOne` lookup from `findOrCreateFlavor`, so every flavor name creates a fresh row. The tests stay green. What is the *general* lesson, and which test would have caught it?

- A) The tests were badly written; a better unit test would catch it
- B) Every fake you install removes a category of bug from the test's view. The bug is in the conversation between the service and the database, and a unit test has replaced the database with an object that answers however it's told. Only a test with a real database — an e2e or integration test — can see it
- C) Jest can't detect duplicate rows
- D) `findOrCreateFlavor` is private, so it can't be tested at all

<details><summary>Answer</summary>

**B.** Measured both ways on 2026-09-29: the broken service gives `Tests: 2 passed, 2 total` under unit tests with faked repositories, and the same broken service against a real Postgres produces `[{"id":1,"name":"vanilla"},{"id":2,"name":"vanilla"}]` where one row was expected (Part B §3.5).

**A** is the seductive wrong answer — you *can* write a unit test that asserts `flavorRepo.findOne` was called, and it would catch this specific bug. But that's an implementation-detail assertion (§3.7a): it breaks on any legitimate rewrite, and it still wouldn't catch the *next* database-shaped bug. The structural answer is B.

</details>

**Q2.** A test asserts `expect(fakeRepo.create).toHaveBeenCalledWith(dto)` and `expect(fakeRepo.save).toHaveBeenCalledWith(dto)`. You wrap the same method in a transaction (note 11) so it now goes through a query runner. The behaviour is identical. What happens, and what should the test have asserted?

- A) The test passes; call assertions survive refactors
- B) The test fails although nothing is broken. It pinned down *how* the method did its job, not *what* it promised. The assertion that survives is on the return value: hand it a DTO, get back the saved coffee with an id
- C) The test fails and that's correct: transactions are a behaviour change
- D) Jest automatically re-records the expected calls

<details><summary>Answer</summary>

**B.** This is the most common way a test suite turns from an asset into a tax. The test that punishes you for tidying code eventually stops you tidying code. Keep call assertions only where the call **is** the contract — an email sent, a card charged, a row deleted.

</details>

**Q3.** Two tests share a `jest.fn()` fake created at the top of the `describe`, and there is no `beforeEach` reset. Test B passes when you run it with `-t 'its name'` and fails when you run the whole file. What is happening, and why is this failure mode considered worse than a plain broken test?

- A) Jest runs tests in a random order; add `--runInBand`
- B) Test A left recorded calls and scripted return values on the shared fake, so B's counts and answers are polluted. It's worse than a plain failure because the error message names B while the cause is in A, and the natural debugging move — re-running B alone — makes it pass, which sends you looking in the wrong file
- C) The test file is too long
- D) `jest.fn()` is not safe to share; each test needs its own

<details><summary>Answer</summary>

**B.** Verified 2026-09-29: the whole file gives `Expected number of calls: 1 / Received number of calls: 2` and `Tests: 1 failed, 1 passed`, while `-t '404 path'` gives `Tests: 1 skipped, 1 passed`. The one-line fix is `jest.clearAllMocks()` in `beforeEach`, which every fake-using spec in this repo has. **D** is a reasonable instinct but unnecessary — sharing the object is fine as long as you clear it.

</details>

**Q4.** A team reports 100% line coverage on their service layer. What can you conclude about the quality of their tests?

- A) That the service layer is well tested
- B) That every line ran at least once during the suite. Nothing about whether anything was *checked* — a suite containing no `expect` at all can reach 100%, and coverage counts `toBeDefined()` the same as a real assertion. It tells you where tests are **absent**, which is useful; it tells you nothing about where they are **weak**
- C) That they have no bugs in that layer
- D) That the error paths are covered

<details><summary>Answer</summary>

**B.** Coverage is a floor detector, not a quality measure. Five of this repo's fifteen tests are `toBeDefined()` checks that would pass with the method bodies deleted, and they all contribute to coverage. Chasing the number pushes people towards exactly those tests. **D** is specifically wrong: throwing paths are among the easiest lines to cover accidentally and the hardest to actually assert on.

</details>

**Q5.** Why does `src/coffee/coffee.service.spec.ts` need `getRepositoryToken(Coffee)` rather than listing `Repository` in `providers`?

- A) Because `Repository` is abstract
- B) Because there is one repository per entity, and the container needs a distinct **name** for each. `@InjectRepository(Coffee)` asks for the name `"CoffeeRepository"`; `getRepositoryToken(Coffee)` computes that same name so the fake is registered under the thing the constructor is actually looking for. The type `Repository<Coffee>` is erased at compile time and can't be the name
- C) Because TypeORM requires it
- D) Because `useValue` only accepts strings

<details><summary>Answer</summary>

**B.** Same reason `coffee.service.ts:38-41`'s comment gives for why `@InjectRepository(Coffee)` is written at all: `<Coffee>` disappears when TypeScript compiles, so the running code would only see "a repository" and not know which table. The token is that information, written in a form that survives compilation. Note 13 §3 step 5 is the general case.

</details>

---

# Part B — End-to-end tests

> 📍 **Where on the Big Map:** the whole map at once. An e2e test starts a real Nest application in this process, makes a real HTTP request to it, and checks the real response — so middleware, guards, interceptors, pipes, the controller, the service, the repository and the SQL all run.
> 📘 **Course:** videos 69 (Diving into e2e Tests) · 70 (Creating our First e2e Test) · 71 (Implementing e2e Test Logic)
> 🌿 **Branch:** `config`
> 📚 **Docs:** [Nest — End-to-end testing](https://docs.nestjs.com/fundamentals/testing) · [supertest](https://github.com/ladjs/supertest)

## B1. The problem

Back to the second requirement from Part A §1:

> **CI must refuse a pull request that breaks the 404 behaviour.**

And now add the thing Part A §3.7(c) proved: a suite of unit tests can be entirely green while the application is broken, because every fake you install is a piece of reality the test stopped watching.

Put those together and the requirement sharpens into something a unit test structurally cannot deliver:

> **Something has to check what a real client actually receives from the real application.** Not what the service returns — what comes back over HTTP, after the validation pipe ran, after the interceptor wrapped it, after the exception filter turned the throw into a status code.

This is not a hypothetical gap. Three of the four things the coffee API promises a browser are decided **outside** `CoffeeService` entirely:

| The promise | Where it's actually decided | Can a `CoffeeService` unit test see it? |
|---|---|---|
| `GET /coffee/999999` → status **404** | `NotFoundException` + Nest's default exception layer (note 05) | it sees the *exception*, never the status code |
| `POST /coffee` with `isAdmin: true` → **400** | `ValidationPipe` bound in `src/main.ts:54` | no — pipes don't run |
| every success is `{ statusCode, data, success }` | `TransformInterceptor` bound in `src/main.ts:69` | no — interceptors don't run |
| a coffee with an existing flavor reuses the row | the SQL, the cascade, the join table | no — the database is a fake |

Four promises, and a unit test of the service can check none of them end to end. That's the case for the second kind of test.

## B2. Mental model

An e2e test is **Insomnia, written down** — a client that calls your running app and checks what comes back.

```
  unit test                          end-to-end test
  ───────────────────────────        ────────────────────────────────────────────────
                                      supertest ── real HTTP ──► ephemeral port
                                            │
  new CoffeeService(fake, fake)             ▼
        │                             ┌──────────────────────────────────────┐
        ▼                             │ middleware → guard → interceptor →   │
  service.findById(999)               │ pipe → controller → service →        │
        │                             │ repository → SQL → Postgres          │
        ▼                             └──────────────────┬───────────────────┘
  throws NotFoundException                               ▼
                                       ◄── 404 {"message":"Coffee #999999 not found",
                                                 "error":"Not Found","statusCode":404}
```

The left column tests a *function*. The right column tests a *promise to a client*. They are answering different questions, and neither replaces the other.

One thing about the right-hand column that the videos gloss over and that matters: **the application really starts.** `createNestApplication()` builds the same object `main.ts` builds, `app.init()` mounts the routes and fires the lifecycle hooks, and supertest binds an HTTP server to a free port and makes an actual request to it. That's why an e2e run needs a database — the repositories are real, so something has to answer them.

## B3. Baby steps

### B3.1 Step 1 — By hand: curl

```bash
pnpm start:dev
curl -i http://localhost:3000/coffee/999999
```

Real behaviour, same as everything above. The problems are Part A §1's problems: manual, once, happy path only, and not runnable by a machine.

### B3.2 Step 2 — supertest: curl, in a test

```ts
import request from 'supertest';

it('GET /coffee/999999 is a 404', () => {
  return request(app.getHttpServer())
    .get('/coffee/999999')
    .expect(404);
});
```

`app.getHttpServer()` hands over the underlying Express server. `request(server)` wraps it so `.get()`, `.post()`, `.send()`, `.set()` and `.expect()` build and check a real request. It's `fetch` with assertions attached, and the thing it's fetching happens to live in the same Node process.

⚠️ Two mechanical details that cost people an hour each:

- **Return the chain, or `await` it.** `request(...).get(...).expect(200)` is a promise. Drop it on the floor and the test finishes before the request does, and passes regardless. Every e2e example returns it.
- **Close the app afterwards.** Without an `afterAll(() => app.close())` you get `Jest did not exit one second after the test run has completed` — the database pool is still open. `app.close()` fires `onModuleDestroy` / `onApplicationShutdown` and releases it.

### B3.3 Step 3 — The test this repo already has, and what it actually proves

`test/app.e2e-spec.ts` is the file the Nest CLI generated:

```ts
beforeEach(async () => {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],                 // ← the whole app
  }).compile();

  app = moduleFixture.createNestApplication();
  await app.init();
});

it('/ (GET)', () => {
  return request(app.getHttpServer())
    .get('/')
    .expect(200)
    .expect('Hello World!');
});
```

`pnpm test:e2e`, 2026-09-29:

```
Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
Snapshots:   0 total
Time:        1.223 s
Ran all test suites.
```

Green. **And it should not be**, if this test is doing what its name suggests.

`src/main.ts:69` binds `TransformInterceptor` globally, and that interceptor wraps every successful response in `{ statusCode, data, success }` (note 06). So a real browser hitting `GET /` does **not** receive `Hello World!`. The test asserting the raw string ought to fail.

I checked instead of guessing. Two applications built in one file — one exactly as `test/app.e2e-spec.ts` builds it, one with `main.ts`'s two global bindings copied in. Real output, 2026-09-29:

```
BARE   status= 200 body= "Hello World!"
CONFIG status= 200 body= "{\"statusCode\":200,\"data\":\"Hello World!\",\"success\":true}"
404    status= 404 body= "{\"message\":\"Coffee #999999 not found\",\"error\":\"Not Found\",\"statusCode\":404}"
```

**There it is.** The test passes because `createNestApplication()` builds the app from the *module graph only*. Everything in `main.ts` that happens **after** `NestFactory.create` — `app.useGlobalPipes(...)` at line 54, `app.useGlobalInterceptors(...)` at line 69 — is in a function that the test never calls. The e2e test is testing an application that no user will ever talk to.

That's worth sitting with, because it's the trap under the whole idea of e2e testing:

> **An end-to-end test is only as end-to-end as the app you built for it.** Anything configured outside the modules — global pipes, global interceptors, global filters, `app.use(helmet())`, CORS, the port, versioning prefixes — must be repeated in the test, or the test is measuring a different program.

Two fixes, and one of them is better:

1. **Repeat the `main.ts` config in the test.** What the course does in video 71 ("any configuration that was added outside of Modules themselves MUST be added and applied here as well"). Simple, and it drifts the moment somebody adds a line to `main.ts` and forgets the spec.
2. **Move the globals into the module, so there is nothing to repeat.** `{ provide: APP_PIPE, useClass: ValidationPipe }` and `{ provide: APP_INTERCEPTOR, useClass: TransformInterceptor }` in `app.module.ts` (note 16 §3 step 4). Then `imports: [AppModule]` genuinely gives you the whole application, the drift is structurally impossible, and as a bonus the blocks become injectable. This is one of the better arguments for `APP_*` over `useGlobalX`, and the course doesn't connect the two topics.

Either way, the assertion in `test/app.e2e-spec.ts:23` becomes `.expect({ statusCode: 200, data: 'Hello World!', success: true })`.

### B3.4 Step 4 — The database question

`test/app.e2e-spec.ts` imports `AppModule`, which contains `TypeOrmModule.forRoot({ host: 'localhost', port: 5432, ..., synchronize: true })` (`src/app.module.ts:57-79`). So **running `pnpm test:e2e` today connects to the development database** — the one currently holding 4 coffees and 1 flavor — and runs `synchronize` against it. Nothing has been destroyed yet only because that single test never writes anything. The first e2e test that inserts, updates or truncates changes that.

Video 70 lays out three options, and they're the right three:

| Option | What it buys | What it costs |
|---|---|---|
| **Mock the repositories** | no database, fast | you're back to Part A's blind spot — no SQL, no constraints, no cascades tested; and it's laborious and fragile |
| **SQLite on disk** | no mocking, fast, zero setup | it isn't Postgres. Queries that work in SQLite fail in production and vice versa; anything Postgres-specific (JSON operators, `RETURNING`, real concurrency, the index types from note 12) is untested |
| **A second real Postgres** | the same engine, the same SQL, the same flow as production | more moving parts: a container to start and stop, locally and in CI |

For a repo that already runs Postgres in Docker, the third is the obvious pick. It's one more service in `docker-compose.yaml`, differing only in the host port:

```yaml
  test-db:
    image: postgres
    restart: always
    ports:
      - '5433:5432'        # ← the only difference that matters
    environment:
      POSTGRES_PASSWORD: pass123
```

And npm's lifecycle hooks start and stop it around the e2e run, so nobody has to remember:

```json
"pretest:e2e":  "docker compose up -d test-db",
"test:e2e":     "node --experimental-vm-modules ./node_modules/jest/bin/jest.js --config ./test/jest-e2e.json",
"posttest:e2e": "docker compose stop test-db && docker compose rm -f test-db"
```

A `pre`- or `post`-prefixed script runs automatically around the script of the same name. ⚠️ **That is an npm feature, and this repo uses pnpm, which turns it off by default.** Verified 2026-09-29 on pnpm 8.15.9 with a three-script probe:

```
> prepost-probe@1.0.0 foo
> echo MAIN-RAN

MAIN-RAN                    ← prefoo and postfoo never ran
```

Adding one line to `.npmrc` brings them back:

```
enable-pre-post-scripts=true
```

```
> prepost-probe@1.0.0 prefoo      PRE-RAN
> prepost-probe@1.0.0 foo         MAIN-RAN
> prepost-probe@1.0.0 postfoo     POST-RAN
```

pnpm disables them by default because an automatic `prepare`/`postinstall` chain is how a malicious package runs code on your machine. So this is a deliberate trade, and turning it on is a decision, not a fix. The alternative that needs no flag is to put both commands in the one script:

```json
"test:e2e": "docker compose up -d test-db && node --experimental-vm-modules ./node_modules/jest/bin/jest.js --config ./test/jest-e2e.json; docker compose stop test-db"
```

(Note the `;` before the stop, not `&&` — you want the database shut down even when the tests fail.)

Then the spec imports the **feature** module plus a connection pointed at 5433, instead of the whole `AppModule`:

```ts
const moduleFixture = await Test.createTestingModule({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres', host: 'localhost', port: 5433,       // ← the test database
      username: 'postgres', password: 'pass123', database: 'postgres',
      autoLoadEntities: true,
      synchronize: true,      // safe here, and only here: the schema is rebuilt from the entities
    }),
    CoffeeModule,             // ← one feature, not the whole app
  ],
}).compile();
```

Two decisions in that block are worth naming.

**Why `synchronize: true` is fine here and dangerous in production.** Note 12 Part B is the long version: `synchronize` makes the schema match your entity classes by whatever means necessary, including dropping a column and its data. On a throwaway database that's exactly what you want — you get a correct schema from nothing, with no migration step. On a database anyone cares about it is a data-loss button.

**Why import `CoffeeModule` and not `AppModule`.** Video 70's point, and it's a good one: modules are features, so test one feature at a time. You boot less, the test runs faster, and a failure names the feature. The cost is B3.3's cost again — the less of the app you build, the more of `main.ts` you have to re-apply by hand.

### B3.5 Step 5 — The same broken code, caught in one line

Now the payoff. Part A §3.7(c) broke `findOrCreateFlavor` by removing the lookup and the unit tests stayed green. Here is the same broken code, against a real Postgres on port 5433, with `main.ts`'s pipe and interceptor applied. Real output, 2026-09-29:

```
POST    201 {"statusCode":201,"data":{"id":1,"name":"Latte","brand":"Sbux","flavor":[{"id":1,"name":"vanilla"}]},"success":true}
BAD     400 {"message":["property isAdmin should not exist"],"error":"Bad Request","statusCode":400}
MISSING 404 {"message":"Coffee #999999 not found","error":"Not Found","statusCode":404}
FLAVOR ROWS (healthy findOrCreateFlavor): [{"id":1,"name":"vanilla"}]
FLAVOR ROWS (broken findOrCreateFlavor): [{"id":1,"name":"vanilla"},{"id":2,"name":"vanilla"}]
```

```
  ● Coffee feature (e2e) › SAME test, after someone "optimises" findOrCreateFlavor

    expect(received).toHaveLength(expected)

    Expected length: 1
    Received length: 2
    Received array:  [{"id": 1, "name": "vanilla"}, {"id": 2, "name": "vanilla"}]

    > 84 |       expect(rows).toHaveLength(1);
         |                    ^

Test Suites: 1 failed, 1 total
Tests:       1 failed, 4 passed, 5 total
```

Five things were just proved, none of which a unit test could have told you:

1. **The duplicate-flavor bug is visible**, because there's a real table to count rows in.
2. **The envelope is real:** `{"statusCode":201,"data":{...},"success":true}`. That's the `TransformInterceptor` running, because the test re-applied it.
3. **The `ValidationPipe` is bound**, proved by `400 ["property isAdmin should not exist"]` rather than a 201 that quietly stores the field.
4. **The 404 contract holds** over actual HTTP, with a status code, not just an exception object.
5. **The cascade works:** `"flavor":[{"id":1,"name":"vanilla"}]` came back with a database-generated id, which means the flavor row was inserted through the coffee's `cascade: true` relation (note 10). No unit test in this repo goes anywhere near that.

That is the whole argument for end-to-end tests, in one terminal dump.

### B3.6 Step 6 — Cleaning up between tests

Real database, shared rows, so Part A's shared-state problem comes back with teeth. The test above starts each case from a known state:

```ts
beforeEach(async () => {
  await dataSource.query('TRUNCATE TABLE coffee_flavors, coffee, flavor RESTART IDENTITY CASCADE');
});
```

`TRUNCATE` empties the tables, `RESTART IDENTITY` puts the id counters back to 1 so a test can rely on the first insert being id 1, and `CASCADE` handles the join table's foreign keys. Without this, "two coffees sharing vanilla produce one flavor row" passes the first run and fails every run after — the classic flaky test.

The usual strategies, from cheapest to strictest:

| Strategy | How | Trade-off |
|---|---|---|
| Truncate between tests | the `beforeEach` above | simple, fast enough for a few dozen tables, and what the demo above uses |
| Each test in a transaction, rolled back after | open a transaction, run the test on it, `ROLLBACK` | fastest and perfectly isolated, but the code under test must use *your* connection, which is awkward once it opens its own (note 11) |
| Rebuild the schema per file | `synchronize` on a fresh database, or `dataSource.synchronize(true)` | strongest isolation, seconds per file |
| A database per parallel worker | `postgres_${JEST_WORKER_ID}` | the answer once e2e files run in parallel — otherwise two workers truncate each other's rows mid-test |

⚠️ **Never write a `TRUNCATE` into a spec whose connection settings you haven't read.** `test/app.e2e-spec.ts` imports `AppModule`, which points at port **5432** — the development database. That single line, dropped into that file, deletes your dev data. This is the most common way people learn the "separate test database" rule.

### B3.7 Step 7 — What a senior does

- **Test contracts, not screens.** An e2e test should read like the promise in the API docs: *POST a valid coffee → 201 with the created coffee*, *GET a missing id → 404*, *POST with an unknown field → 400*. Keep them coarse. An e2e test that asserts on fifteen fields of a response breaks every time somebody adds a column, and the failure teaches nobody anything. Jest's partial matchers (`expect.objectContaining`, `expect.arrayContaining` — video 71's "Jasmine helpers") exist for exactly this.
- **Pick the handful that would embarrass you.** e2e tests are seconds each and need infrastructure, so they're a budget. Spend it on the paths where being wrong is expensive: create, the auth boundary, payment, the error contracts other teams have built against. Not on the fifth variation of a list filter — that's a unit test.
- **Everything in `main.ts` is a liability for your e2e suite.** B3.3 measured what that costs. The structural fix is to keep `main.ts` as close to empty as you can and register global blocks with `APP_PIPE` / `APP_INTERCEPTOR` / `APP_GUARD` / `APP_FILTER` in modules (note 16 §3 step 4), so that "build the app" means the same thing in both places.
- **In CI, the database is a service, not a step.** GitHub Actions and GitLab CI both let a job declare a Postgres service container that comes up before the job runs. That's the CI equivalent of starting `test-db` around the run, and it means CI doesn't depend on the pnpm hook question at all. The requirement from §1 — *CI must refuse a pull request that breaks the 404* — is satisfied when `pnpm test:e2e` is a **required** check on the pull request, not merely a job that exists.
- **Know which failures e2e gives you and which it doesn't.** A red e2e test says "something in this chain is wrong" and hands you a status code; it rarely names a line. That's the trade for coverage of the joins. The pairing that works: e2e proves the promise, and when one goes red you often add a unit test at the level that now knows exactly what broke.
- **Time, order, and parallelism are where flakes come from.** Tests that depend on ids being 1, 2, 3 break when another test ran first. Tests that assert on `createdAt` break at midnight. Tests that pass serially break under `--maxWorkers=4` because two workers share a database. Fix all three the same way: explicit setup per test, no reliance on order, one database per worker.

## B4. How it works underneath

```
 Test.createTestingModule({ imports: [TypeOrmModule.forRoot({ port: 5433 }), CoffeeModule] })
        │
        │  .compile()          → the container builds every provider (a real pg pool included)
        ▼
 moduleFixture.createNestApplication()
        │                      → wraps the container in an Express app, same as NestFactory.create
        │  ⚠️ NOTHING from main.ts happened. Globals bound there do not exist here.
        ▼
 app.useGlobalPipes(...)       → you re-apply them, by hand
 app.useGlobalInterceptors(...)
        │
        ▼
 await app.init()              → routes mounted, onModuleInit fired, DB connected
        │
        ▼
 request(app.getHttpServer())  → supertest takes the raw http.Server,
        │                        listens on a free port, opens a real TCP connection
        ▼
 GET /coffee/999999            → Express → Nest route handler
        │                        → guards → interceptors(before) → pipes
        │                        → CoffeeController.findById → CoffeeService.findById
        │                        → SELECT ... FROM coffee WHERE id = $1  (real SQL, port 5433)
        │                        → null → throw NotFoundException
        │                        → exception layer → 404 JSON
        ▼
 .expect(404)                  → supertest compares, Jest reports
        │
        ▼
 afterAll: app.close()         → onApplicationShutdown, pool released
                                 (skip it → "Jest did not exit one second after the test run")
```

The one line to remember from that diagram is the ⚠️. Everything else is the machinery you already know from note 16 running exactly as it does in production — which is the point.

## B5. Functional vs class

There is no meaningful functional version of an e2e test, and that's informative rather than disappointing.

```ts
// the closest you can get by hand
const app = express();
app.get('/coffee/:id', async (req, res) => { /* re-implement the route */ });
```

The moment you hand-wire the app, you are testing **your reconstruction** of the application, not the application. Every difference between your hand-built app and the real one — a pipe you forgot, a guard that isn't there, a route prefix — is a bug the test can never find. `createNestApplication()` earns its ceremony precisely because it builds the same thing `main.ts` builds, from the same module metadata, with the same container.

So the split from Part A §5 holds, with the scope turned up:

| | Hand-built (functional) | `Test.createTestingModule` |
|---|---|---|
| A pure function (fixture builder, formatter, calculator) | ✅ import it and call it | ❌ pure cost |
| A service with injected dependencies | works, but order-dependent and it doesn't scale | ✅ names instead of positions, the real wiring |
| A controller with its pipes and guards | ❌ they don't run | ✅ `createNestApplication` runs them |
| A whole feature over HTTP | ❌ you'd be testing your own mock app | ✅ the only real option |

And the cost, restated because B3.3 measured it: **what the container builds is the module graph, and nothing else.** `main.ts` is outside the graph, so the "real wiring" guarantee stops exactly at the edge of your modules. That's an argument for putting as little as possible in `main.ts`.

## B6. In my project

- `test/app.e2e-spec.ts` — the only e2e file. `pnpm test:e2e` (2026-09-29): `Test Suites: 1 passed, 1 total · Tests: 1 passed, 1 total · Time: 1.223 s`.
- `test/app.e2e-spec.ts:23` — `.expect('Hello World!')`. **This passes, and it shouldn't.** Verified 2026-09-29 by building both versions side by side: the app this spec builds returns `"Hello World!"`, while the app `main.ts` builds returns `{"statusCode":200,"data":"Hello World!","success":true}`. The cause is `createNestApplication()` not running `main.ts`, so `src/main.ts:69`'s `TransformInterceptor` is absent (B3.3). **The green tick is currently a lie about production.**
- `test/app.e2e-spec.ts:10` — `beforeEach`, so the entire application (including the Postgres connection) is rebuilt for every test. With one test that's invisible; at ten tests it's ten boots. Video 69 changes this to `beforeAll` for exactly this reason, and this file hasn't been changed yet.
- `test/app.e2e-spec.ts:26` — `afterEach(() => app.close())` is present, which is why there's no `Jest did not exit` warning.
- `test/jest-e2e.json` — its own config, `testRegex: ".e2e-spec.ts$"`, with the same ESM settings as `jest.config.ts` (`extensionsToTreatAsEsm`, `ts-jest` `useESM`, the `esnext` override). This is why the two suites don't see each other's files.
- `package.json:20` — `"test:e2e"` carries the same `--experimental-vm-modules` flag. Nothing starts a database around it, and `docker-compose.yaml` defines **one** service, `db`, on port 5432. (There is also no `.npmrc`, so even if `pretest:e2e` were added, pnpm would skip it — B3.4.) So the e2e suite runs against the development database — currently 4 coffees and 1 flavor — with `synchronize: true` (`src/app.module.ts:78`). Nothing has been lost yet only because the single test is read-only. B3.4 is the fix, and it's practice task 3.
- `src/main.ts:54` and `src/main.ts:69` — the two lines that have to be repeated in every e2e spec until they move into `app.module.ts` as `APP_PIPE` / `APP_INTERCEPTOR` (note 16 §3 step 4 — which is already practice task 2 over there, and this is the second reason to do it).
- **Verified against a real second database.** Running a throwaway Postgres on 5433 and pointing a scratch spec at it gave, 2026-09-29: `POST 201 {"statusCode":201,"data":{"id":1,...,"flavor":[{"id":1,"name":"vanilla"}]},"success":true}`, `400 {"message":["property isAdmin should not exist"],...}`, `404 {"message":"Coffee #999999 not found",...}`, and one flavor row for two coffees sharing `"vanilla"`. All four promises from B1 hold — and every one of them was checked by something no unit test in this repo touches.

## B7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| Run e2e tests against the development database | The first test with a `TRUNCATE` or a destructive `synchronize` deletes your data. This repo is one line away from it today: `test/app.e2e-spec.ts` imports `AppModule`, which points at port 5432 and has `synchronize: true` | you, at the moment you discover it, plus anyone sharing that database |
| Build the app in the test without repeating `main.ts` | The test measures a program no user runs. **Verified:** `test/app.e2e-spec.ts` is green asserting `'Hello World!'`, while real clients get `{"statusCode":200,"data":"Hello World!","success":true}` | whoever trusts the green build; the bug ships and the suite says everything is fine |
| Forget to `return` or `await` the supertest chain | The test ends before the request does and passes whatever the server said. A test that can never fail | everyone, silently and forever, because nothing ever looks wrong |
| No cleanup between e2e tests | Rows from test A change test B's counts and ids. Passes on a fresh database, fails on the second run, passes again after a manual wipe | whoever chases a "random" CI failure that won't reproduce locally |
| Rebuild the whole application in `beforeEach` | Every test pays a full boot plus a database connection. Ten tests, ten boots; the suite gets slow enough that people stop running it | the CI queue, and the habit of running tests before pushing |
| Skip `app.close()` | `Jest did not exit one second after the test run has completed` — the pool is still open. In CI the job hangs until it's killed | whoever waits ten minutes for a timeout instead of getting a result |
| Assert on the full response body field by field | Adding one column to the entity breaks a dozen e2e tests that were never about that column | the next person to add a field, who spends the afternoon updating expectations |
| Cover everything with e2e tests because they "test more" | Minutes per run instead of seconds, infrastructure needed on every machine, and failures that say "something in this chain broke" without naming a line | the whole team's feedback loop; the pyramid exists for a reason (§8) |

## B8. 🧠 Senior engineer lens

- **The word "integration test" is the missing middle, and it's where most value sits.** Between "one class, everything faked" and "the whole app over HTTP" there's a test that builds a real service against a real database and calls it directly — no HTTP, no pipes. It would have caught the duplicate-flavor bug in milliseconds, without booting Express. Nest doesn't name this layer and the course doesn't either, but `Test.createTestingModule({ imports: [TypeOrmModule.forRoot(testDb), CoffeeModule] })` and then `module.get(CoffeeService)` is exactly it. When people say "our unit tests are green and production is broken", this is usually the layer that's missing.
- **An e2e suite is a product with an owner.** It needs a database that can be created from nothing, seed data that's version-controlled, a way to run one test locally, and a rule about who fixes it when it's red. Suites without those become the thing everyone skips with `--testPathIgnorePatterns`.
- **Flakiness compounds.** A suite of 50 e2e tests each passing 99% of the time is green 60% of the time. That arithmetic is why teams that tolerate flakes end up ignoring the whole suite. Budget time to fix or delete them, and treat "re-run the build" as an incident, not a workflow.
- **Contract tests are the next idea along.** Once two services talk to each other, e2e-ing them together is slow and fragile. The step up is for each side to test against a shared, versioned description of the contract, so the provider's build fails when it breaks a consumer, without either running the other. Same instinct as this note: write the promise down where a machine can check it.
- **Test data is a design problem.** The moment there are more than a handful of e2e tests, `{ name: 'Latte', brand: 'Sbux' }` inline in twenty places becomes the thing you edit for an hour when the DTO changes. A fixture builder — `makeCoffee({ name: 'Latte' })` with sensible defaults — is a pure function, needs no Nest, and is the highest-value thing you can add to a growing suite. Video 71 gestures at this ("a separate file with expected static responses and DTOs").
- **What good looks like, concretely, for this repo:** `pnpm test` green in under 3 seconds on every save; four or five e2e tests covering create, get-one, get-missing, validation-rejected and pagination; both required on every pull request; a `test-db` service on 5433 that `pnpm test:e2e` starts and stops for you; and `main.ts` thin enough that `imports: [AppModule]` really is the whole application.

## B9. 🔗 Connects to

- Part A above — why unit tests are blind to everything this part tests
- [16 — Building blocks and binding](16-building-blocks-and-binding.md) §3 step 4 — `APP_PIPE` / `APP_INTERCEPTOR` are what stop B3.3's drift between `main.ts` and your e2e app
- [06 — Interceptors](06-interceptors.md) — the `TransformInterceptor` whose absence makes `test/app.e2e-spec.ts` pass when it shouldn't
- [07 — Pipes & validation](07-pipes-validation.md) — the `ValidationPipe` an e2e test has to re-bind, and the `400 ["property isAdmin should not exist"]` it produces
- [09 — Database, Docker & TypeORM](09-database-docker-typeorm.md) — adding the `test-db` service to `docker-compose.yaml`
- [12 — Indexes & Migrations](12-indexes-migrations.md) Part B — why `synchronize: true` is right for a throwaway test database and wrong everywhere else
- [10 — Relations](10-relations.md) — the cascade that the e2e test proved and no unit test touches
- [05 — Exception filters](05-exception-filters.md) — where `NotFoundException` becomes an actual 404 over HTTP

## B10. ✍️ In my own words
> _(mine to write)_

## B11. 🛠️ Practice (Part B)

1. **Make the existing e2e test honest.** `test/app.e2e-spec.ts` passes while asserting a response real users never get. Fix it so that it tests the application `main.ts` actually builds. Do it twice: once the quick way, once the way that can't drift.

   <details><summary>Hints</summary>

   - Look at what sits between `NestFactory.create(AppModule)` and `app.listen(...)` in `src/main.ts`. Ask which of those lines the test ever executes.
   - Quick way: `createNestApplication()` returns an app object with the same methods `main.ts` calls on it.
   - Drift-proof way: note 16 §3 step 4. If the block is registered as a provider, the module graph carries it, and `imports: [AppModule]` brings it along for free.
   - Then update the assertion. §B3.3 has the exact body.
   - While you're there: `beforeEach` at line 10 rebuilds the whole app per test. Video 69 changes it, and says why.
   </details>

2. **Write `test/coffee/coffee.e2e-spec.ts` for the four promises from B1.** POST a valid coffee → 201; POST with an unknown field → 400; GET a missing id → 404; GET the list → 200 with an array.

   <details><summary>Hints</summary>

   - Import `CoffeeModule`, not `AppModule`, plus a `TypeOrmModule.forRoot(...)` of your own (B3.4). Video 70's reasoning for one-feature-at-a-time is worth reading.
   - Re-apply the globals from `main.ts`, or task 1 has already made that unnecessary.
   - `it.todo('POST /coffee creates one')` lets you commit the list of scenarios before you implement them; Jest prints todos in the report so they nag you.
   - The 400 case needs a body with a field that isn't in `CreateCoffeeDto`. `main.ts:57` says what the pipe does with it.
   - Use `beforeAll` for the app, `afterAll` for `app.close()`.
   </details>

3. **Give the e2e suite its own database.** Add a `test-db` service to `docker-compose.yaml` on port 5433, make `pnpm test:e2e` start and stop it, then point task 2's spec at it. Verify by inserting a coffee in a test and checking the dev database on 5432 is untouched.

   <details><summary>Hints</summary>

   - The new service is a copy of `db` with one host port changed. Inside the container it's still 5432.
   - `docker compose up -d <service>` starts one service by name.
   - The course uses npm's `pretest:e2e` / `posttest:e2e` hooks. Try it, run `pnpm test:e2e`, and watch whether the container starts — B3.4 says what you'll find and gives you two ways out.
   - Whichever way you go, make sure the database stops even when the tests **fail**.
   - `synchronize: true` is what gives the empty database its tables, with no migration step. Note 12 Part B says why you'd never do this on the real one.
   - Check it worked from the outside: `docker compose exec db psql -U postgres -c "select count(*) from coffee;"` before and after.
   </details>

4. **Catch the `findOrCreateFlavor` bug for real.** Write the e2e test that fails when the lookup is removed: POST two coffees that share a flavor name, then assert the `flavor` table holds one row.

   <details><summary>Hints</summary>

   - You need the connection to ask the database a question directly. `moduleFixture.get(DataSource)` gives you TypeORM's connection object, and it has a `query()` method that takes raw SQL.
   - Reset the tables in `beforeEach` (B3.6) or the second run will disagree with the first.
   - Then break `findOrCreateFlavor` the way §3.7(c) does, watch the test go red, and put it back. That red is the thing Part A could not produce.
   </details>

5. **Pagination, end to end.** `PaginationQueryDto` promises `?limit=2&offset=0` returns two coffees and `?limit=abc` is a 400. Insert three coffees in the test, then check both.

   <details><summary>Hints</summary>

   - The 400 only happens if the `ValidationPipe` is applied to your test app — which is task 1's whole point, and a good check that you did it.
   - Insert the fixtures through the API (`POST /coffee` three times) or through the repository. One of those is testing the API with the API; think about which you want and why.
   - `?limit=0` and `?limit=-1`: read `@IsPositive` and predict the status code before running it.
   </details>

6. **Measure the cost.** Time `pnpm test` and `pnpm test:e2e` before and after tasks 2–5. Write down the two numbers and one sentence about what that ratio means for which tests you'd run on every file save and which on every pull request.

## B12. ❓ Quiz (Part B)

**Q1.** `test/app.e2e-spec.ts` asserts `GET /` returns the raw string `'Hello World!'`, and it passes — although `src/main.ts:69` binds a global interceptor that wraps every response in `{ statusCode, data, success }`. Why does it pass, and what does that tell you about e2e tests in general?

- A) `TransformInterceptor` skips the root route
- B) `createNestApplication()` builds the app from the **module graph only**. Everything in `main.ts` after `NestFactory.create` — the global pipe at line 54 and the global interceptor at line 69 — is in a function the test never calls, so the test exercises an application no user will ever talk to. An e2e test is only as end-to-end as the app you built for it
- C) supertest strips the envelope before comparing
- D) The interceptor only runs when the app is started with `app.listen()`

<details><summary>Answer</summary>

**B.** Verified 2026-09-29 by building both in one file: `BARE status=200 body="Hello World!"` versus `CONFIG status=200 body="{\"statusCode\":200,\"data\":\"Hello World!\",\"success\":true}"`. The structural fix is to move global blocks into `app.module.ts` as `APP_PIPE` / `APP_INTERCEPTOR` (note 16 §3 step 4), so "build the app" means the same thing in `main.ts` and in the test.

</details>

**Q2.** Your unit tests for `CoffeeService` are green. An e2e test posting two coffees with the same flavor name fails with `Expected length: 1 / Received length: 2`. What kind of bug is this, and what does it say about the two kinds of test?

- A) The e2e test is wrong; unit tests are the source of truth
- B) It's a bug in the conversation between the service and the database — the lookup that should reuse an existing flavor row is gone. The unit test replaced the database with an object that answers however it's told, so the bug is outside what it can observe. Unit tests check your code; only a test with a real database checks your code's use of the database
- C) A race condition between the two POSTs
- D) `synchronize: true` created a duplicate table

<details><summary>Answer</summary>

**B.** Both halves measured on 2026-09-29: `Tests: 2 passed, 2 total` for the unit tests against the broken service, and `Received array: [{"id": 1, "name": "vanilla"}, {"id": 2, "name": "vanilla"}]` for the same code over HTTP against Postgres.

**C** deserves a moment though: with *concurrent* requests this same code has a genuine race even when the lookup is present — two requests can both find nothing and both insert. The fix for that one is a unique constraint on `flavor.name` (note 12 Part A), not a test.

</details>

**Q3.** A colleague adds `await dataSource.query('TRUNCATE TABLE coffee CASCADE')` to a `beforeEach` in `test/app.e2e-spec.ts` so tests start clean. What happens on the first run?

- A) Nothing; e2e tests always use a separate database
- B) The development database is emptied. `test/app.e2e-spec.ts` imports `AppModule`, whose `TypeOrmModule.forRoot` points at `localhost:5432` — the container in `docker-compose.yaml`, currently holding 4 coffees and 1 flavor. There is no test database in this repo yet, so "the database" and "my data" are the same thing
- C) Jest refuses to run destructive SQL
- D) `synchronize: true` restores the rows afterwards

<details><summary>Answer</summary>

**B.** `src/app.module.ts:57-79` is the connection, and `docker-compose.yaml` defines exactly one service. **D** is worth being clear about: `synchronize` matches the *schema* to your entities and has no opinion about rows — it will happily rebuild an empty table. Fix the setup (B3.4) before the cleanup.

</details>

**Q4.** Why does the course insist that an e2e spec import `CoffeeModule` rather than `AppModule`, and what does that choice cost?

- A) `AppModule` can't be imported into a testing module
- B) Modules are features, so importing one tests one feature: less to boot, faster runs, and a failure that names the area. The cost is that the further you get from the real application, the more of `main.ts`'s configuration you have to re-apply by hand — and the easier it is to forget a piece and test something users never touch
- C) `AppModule` has no controllers
- D) Importing `AppModule` disables the ValidationPipe

<details><summary>Answer</summary>

**B.** This is the same trade as everywhere in testing: isolation buys speed and precise failures, and pays for it with distance from reality. Note that **D** is accidentally close to a true statement for the wrong reason — the `ValidationPipe` is absent either way, because it lives in `main.ts`, not in a module (Q1).

</details>

**Q5.** A suite of 50 e2e tests each passes 99% of the time. How often is the build green, and why does that number change how a team behaves?

- A) 99% — the failures are independent
- B) About 60% (0.99⁵⁰). Two runs in five are red for no reason, so the team learns that red means "re-run it", and from then on real failures are invisible too. Flakes don't just waste time; they destroy the signal the whole suite exists to provide
- C) 50%
- D) It depends on the order the tests run in

<details><summary>Answer</summary>

**B.** 0.99⁵⁰ ≈ 0.605. This arithmetic is the reason mature teams treat a flaky test as an incident and either fix it or delete it the same day. The usual causes are in §8 and B3.7: shared state, real time, test order, unawaited promises, and one database shared by parallel workers.

</details>

**Q6.** You want a test that would have caught the duplicate-flavor bug in milliseconds, without booting Express or making an HTTP request. What does it look like?

- A) Impossible: catching it requires a real database, and a real database requires an e2e test
- B) A test that builds `CoffeeModule` against a real test database with `Test.createTestingModule`, pulls `CoffeeService` out with `module.get(...)`, and calls `create()` twice directly. Real SQL, no HTTP, no pipes — the layer between "unit" and "e2e" that Nest doesn't give a name to
- C) A unit test with a better mock
- D) A snapshot test

<details><summary>Answer</summary>

**B.** It's the same `Test.createTestingModule` you already use, with `TypeOrmModule.forRoot(testDb)` in `imports` instead of `useValue` fakes in `providers` — and then no `createNestApplication()`. This "integration" layer is where a lot of the real defects in a CRUD service actually live, and it's the part the pyramid picture tends to squeeze out. **C** is what people try first, and §3.7(c) shows what it's worth.

</details>
