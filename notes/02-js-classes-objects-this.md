# 02 — JS Classes, Objects & `this`

> 📍 **Where on the Big Map:** under everything. Every controller, service, filter, interceptor, guard and pipe is a class.
> 📘 **Course:** not taught by the course; assumed from video 7 (the first controller) onwards · 🎥 **YouTube video:** used from 00:11:48 onwards (not explained in the video) · 🌿 **Branch:** `main`

## 1. The problem

Open `src/user/user.service.ts:43`. The line that makes the whole service work is:

```ts
constructor(private readonly userLoggerService: UserLoggerService) {}
```

and further down, at `src/user/user.service.ts:103`, the data is read as `this.users.find(...)`. If you have only ever written functional JavaScript, this is strange in two ways. You know how to make an object that remembers things: a factory function with a closure. And you have never needed the word `this`.

So the natural first attempt is to write the class the way you would write the factory:

```ts
class UserService {
  constructor(userLoggerService: UserLoggerService) {
    const users = [{ id: 1, name: 'saim' }];      // "remembered" the closure way
  }
  getUserByName(name: string) {
    return users.find((u) => u.name === name);    // ❌ Cannot find name 'users'
  }
}
```

TypeScript refuses to compile it, and plain JS would throw `ReferenceError: users is not defined` the first time the method runs. The method cannot see the constructor's variable. And once you fix that and start using `this`, a second trap is waiting: pass a method somewhere as a callback (`users.map(this.toDto)`) and it crashes at request time with `TypeError: Cannot read properties of undefined`.

Nest is built entirely from classes, so these two things (where data lives, and what `this` is) have to be clear before anything else in this course makes sense.

## 2. Mental model

```
class       = the cookie cutter (a recipe for objects)
new         = pressing the cutter into dough → an actual cookie (object in memory)
constructor = decorating the fresh cookie (putting starting values on it)
this        = "the cookie I'm working on right now"
field       = something stored ON the cookie
method      = something every cookie can do (shared, stored once on the cutter)
```

Functional comparison: a class is **another way to write a function that makes objects**. A field is what a closure variable would have been. `this` is the object before the dot in the call. The extras a class adds are that methods are stored once instead of copied per object, inheritance (`extends`) is built in, and, the reason Nest cares, **a framework can read information about a class at runtime** (labels from decorators, constructor parameter types).

## 3. Baby steps

### Step 1: the factory function you already write

```js
function createUser(name) {
  return {
    name,
    greet() { return "Hi, I'm " + this.name; },
  };
}
const u = createUser('saim');
u.greet();   // "Hi, I'm saim"
```

This works and it is a perfectly good way to make objects. Two things are less good about it. First, every call to `createUser` creates a **fresh copy of `greet`**: ten thousand users means ten thousand `greet` functions in memory. Second, there is nothing here a framework could inspect. `createUser` is a function; there is no place to attach "I am a controller for `/user`", and no way for anything to know what arguments it wants.

### Step 2: naive class, written with closure thinking

```js
class Counter {
  constructor(start) { /* `start` dies when this function ends */ }
  inc() { start++; }                  // ❌ ReferenceError: start is not defined
}
```

**What breaks:** in functional code, closures remember variables because the inner function is written *inside* the outer one:

```js
function createCounter(start) {
  let count = start;
  return { inc() { count++; } };     // inc "sees" count, closure ✅
}
```

In a class, `inc` is **not inside** the constructor. They are two separate functions that happen to be written in the same block. When the constructor finishes, its local variables are gone, exactly like any other function's locals.

### Step 3: better. Store the data on the object

The object created by `new` is the only thing that survives after the constructor returns, and it is the one thing every method can reach. So you move the data from the temporary variable onto the object, and read it back later:

```js
class Counter {
  constructor(start) { this.count = start; }  // move from temporary variable → object
  inc() { this.count++; }                      // read from object
}
```

Why is this not automatic? Because not every parameter should be stored. Some are only used to compute something (`this.total = price * qty`), some are validated and thrown away. JavaScript leaves the choice to you.

**What is still wrong:** it now works when called as `counter.inc()`, and silently does not when the method is handed around:

```js
const c = new Counter(0);
const fn = c.inc;
fn();   // TypeError: Cannot read properties of undefined (reading 'count')
```

Nothing is before the dot, so `this` is `undefined` (class bodies always run in strict mode). The code looks right, compiles fine, and blows up at the moment of the call.

### Step 4: what a senior does

Know the four rules of `this` (section 4), and write code that does not depend on the caller getting it right:

```ts
class UserService {
  constructor(private readonly userLoggerService: UserLoggerService) {}   // stored on the object by TS
  private users: User[] = [{ id: 1, name: 'saim' }];                         // per-object data

  getUserByName(name: string) {
    return this.users.find((u) => u.name === name);   // arrow: keeps the method's `this`
  }
}
```

Data goes on the object, callbacks are arrow functions so they borrow the method's `this`, and anything that must be truly hidden uses `#field` rather than the TypeScript-only `private` (section 7). Prefer receiving collaborators in the constructor over `extends` chains (section 8).

The vocabulary for all this, now that you have seen it: the recipe is a **class**, the object `new` makes from it is an **instance**, the setup function is the **constructor**, per-object data are **fields**, shared functions are **methods**, and the `private readonly x: X` shortcut in a constructor is a **parameter property**.

## 4. How it works underneath

### 4.1 "Creating an object" means using a piece of memory

```js
const a = { name: 'saim' };
const b = a;           // copies the ADDRESS, not the object
b.name = 'ali';
a.name;                // 'ali' ← same object
```

```
 variables          memory (RAM)
 a ──┐
     ├────────►  { name: 'ali' }
 b ──┘
```

Variables hold an **address**. `new` makes a **new** piece of memory. This is also why `find()` in `src/user/user.service.ts:168-176` can change the stored user: it returns the address of the object inside the array, not a copy.

### 4.2 What `new User('saim')` really does

```js
class User {
  role = 'member';                    // field with starting value
  constructor(name) { this.name = name; }
  greet() { return 'Hi ' + this.name; }
}
```

```
1. obj = {}                                  ← `new` creates the empty object
2. link obj to User.prototype                ← so obj can use greet() (shared)
3. obj.role = 'member'                       ← field initializers run (in written order)
4. run constructor with this = obj           ← obj.name = 'saim'
5. return obj
```

Before the `class` keyword existed, people wrote the same thing by hand, and it is still what runs underneath:

```js
function User(name) {                      // the "constructor"
  this.role = 'member';
  this.name = name;
}
User.prototype.greet = function () {       // one shared function
  return 'Hi ' + this.name;
};
const u = new User('saim');                // steps 1–5 above
```

⚠️ Verified from this repo's own compiled code (`dist/user/user.service.js:15-24`): **fields first, then the constructor body.** This is what the TypeScript in `src/user/user.service.ts` becomes:

```js
let UserService = class UserService {
    userLoggerService;                              // field declared (undefined for now)
    constructor(userLoggerService) {
        this.userLoggerService = userLoggerService; // the parameter property's hidden line
    }
    users = [
        { id: 1, name: 'saim' },
        { id: 2, name: 'Jane Smith' },
        { id: 3, name: 'Alice Johnson' },
    ];
    getUserByName(name) { ... }
```

Reading it in that order: `obj.userLoggerService = undefined`, then `obj.users = [...]`, and only then does the constructor body set `obj.userLoggerService = logger`. Types, `private` and `readonly` are gone; they never existed at runtime.

### 4.3 Methods live on the prototype (stored once)

```
 User.prototype:  { greet: ƒ }      ← ONE greet function in memory
        ▲             ▲
        │             │
   userA {name}   userB {name}      ← each object only stores its own data
```

`userA.greet()` makes JS look on `userA`, not find `greet`, walk up to `User.prototype`, find it there, and call it with `this = userA`. Factory functions returning object literals create a **new copy** of every method per object instead.

### 4.4 `this` is decided by HOW you call, not where it's written

| Call style | `this` is |
|---|---|
| `obj.method()` | `obj` (the thing before the dot) |
| `const f = obj.method; f()` | `undefined` (class code is strict mode) → crash |
| `new Thing()` | the brand-new object |
| arrow function `() => this.x` | **no own `this`**; uses the `this` of the surrounding code |

This is why `this.users.find((u) => ...)` works fine inside a method: the arrow does not have its own `this`, so it borrows the method's. A `function () {}` callback would have its own (undefined) `this` and lose the service.

### 4.5 The chain of `this` in one request through this repo

Nest always calls your methods with the dot, so `this` is right at every level:

```
 GET /user?name=saim
   │
   ▼
 Nest calls  userController.getUser('saim')                src/user/user.controller.ts:59
             └─ inside: this = userController               (the object built at startup)
                  │
                  ▼
             this.userService.getUserByName('saim')          src/user/user.service.ts:94
             └─ inside: this = userService
                  │
                  ▼
             this.userLoggerService.log('Searching ...')     src/user/user.logger.service.ts:19
             └─ inside: this = userLoggerService
                  │
                  ▼
             console.log('[UserLoggerService] Searching for user with name: saim')
```

Each arrow is a call with something before the dot. Break any one of them (hand the method around without the dot) and that level's `this` becomes `undefined`.

### 4.6 TypeScript extras you'll see in Nest

```ts
constructor(private readonly userLoggerService: UserLoggerService) {}
```
is shorthand for:
```ts
private readonly userLoggerService: UserLoggerService;
constructor(userLoggerService: UserLoggerService) {
  this.userLoggerService = userLoggerService;
}
```

The shorthand exists because "take this parameter and store it on the object under the same name" is what nearly every Nest constructor does. Nothing else in the class changes.

| Keyword | Meaning | Exists at runtime? |
|---|---|---|
| `private` | only this class's code may use it | ❌ TS check only. It's a normal property in JS. (`#field` is real runtime privacy.) |
| `readonly` | can't reassign after construction | ❌ TS check only |
| `: UserLoggerService` | the type | ❌ erased... **except** Nest keeps constructor param types via `emitDecoratorMetadata` (note 03) |
| `extends` | inherit fields + methods from another class | ✅ |
| `implements NestInterceptor` | "I promise to have the methods this interface lists" | ❌ TS check only |

## 5. Functional vs class

The same service, both ways. The functional version is written out as a comment at `src/user/user.service.ts:190-211`.

```js
// Functional: data in closure variables
function createUserService(userLoggerService) {      // <- constructor param
  const users = [{ id: 1, name: 'saim' }];           // <- private field

  return {
    getUserByName(name) {
      const user = users.find((u) => u.name === name);   // closure, no `this`
      userLoggerService.log(`Searching for user with name: ${name}`);
      return user;
    },
  };
}
const userService = createUserService(createUserLogger());
```

```ts
// Class: data on the object, reached through `this`
@Injectable()
export class UserService {
  constructor(private readonly userLoggerService: UserLoggerService) {}
  private users: User[] = [{ id: 1, name: 'saim' }];

  getUserByName(name: string) {
    const user = this.users.find((u) => u.name === name);
    this.userLoggerService.log(`Searching for user with name: ${name}`);
    return user;
  }
}
// Nest does: new UserService(new UserLoggerService())
```

Line by line they map onto each other: constructor parameter ↔ factory parameter, field ↔ closure variable, `this.users` ↔ `users`.

**What the class version buys:**
- One copy of each method, on the prototype, however many objects exist.
- A runtime value (the class) that decorators can label and that Nest can look up the constructor's parameter types on. `@Injectable()` has nowhere to go on a factory function, and there is no way to ask a factory what it wants passed in. This is the reason Nest is class-based, and it is the whole subject of note 03.
- `instanceof`, `extends`, and `implements` for free.
- Real privacy is available with `#field` (the closure version has it by default).

**What it costs:**
- `this` depends on the call site. The closure version cannot lose its data no matter how the method is passed around.
- Field order and constructor order become something you must know (section 4.2).
- More ceremony: `private readonly`, types, decorators.

**When to pick which:** inside Nest, class, because the framework needs it. In a plain script or a small helper module, a factory function with closures is usually clearer and safer. The senior habit is to know which trade you are making.

## 6. In my project

- `src/user/user.service.ts:43`: the parameter property. The long form it expands to is written above it at `:20-24`.
- `src/user/user.service.ts:84-88`: a field with a starting value (`private users: User[] = [...]`), and the walkthrough of what `new UserService(logger)` does, step by step, at `:62-68`.
- `src/user/user.service.ts:103`: an arrow callback inside a method, so `this` still means the service.
- `src/user/user.service.ts:107`: using the injected dependency through `this.userLoggerService`.
- `src/user/user.controller.ts:42`: the same shortcut on the controller. `:48` is a field (`private requestCount = 0`) living on the one shared controller object (note 04). `:65` is a bare `this;`, with a comment showing that logging it prints `UserController { userService: UserService { userLoggerService: ..., users: [...] } }`.
- `src/user/user.controller.ts:148-158`: the full chain of `this` for `GET /user?name=saim`, the same sequence as section 4.5.
- `src/user/dto/update-user.dto.ts:38`: `extends PartialType(CreateUserDto)`. You can extend any expression that returns a class; `extends` does not need a name.
- `src/user/dto/create-user.dto.ts:45`: a class used mainly as a **type** and as a place for labels; Nest never calls `new CreateUserDto()` for a request body (note 07).
- `src/utils/transform.interceptor.ts:18`: `implements NestInterceptor` (note 06).
- `dist/user/user.service.js:15-24`: the compiled truth, quoted in section 4.2. Run `pnpm build` to regenerate it.

## 7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| Pass a method as a callback: `arr.map(this.format)` | `this` is lost inside `format`, so `this.x` throws `TypeError: Cannot read properties of undefined`. Use `arr.map((x) => this.format(x))`. | Every user hitting that route, at request time, not at startup |
| Forget `private`/`readonly` on a constructor param and still use `this.x` | The value was never stored. TS error, or `undefined` in plain JS. | You, reading a confusing "property does not exist" message |
| Rely on `private` to hide secrets | It's compile-time only. `console.log(service)` prints "private" fields, **including API keys**, into the logs. | The whole company, when the log system is readable by more people than the vault is |
| Deep inheritance chains (`A extends B extends C extends D`) | Changing D breaks A in surprising ways. Prefer composition: receive what you need in the constructor (that's what DI is). | The developer changing D, who cannot see A from there |
| Use a constructor parameter from a field initializer, through a method call (`ready = this.check()` where `check` reads `this.logger`) | Field initializers run **before** the constructor body (section 4.2), so `this.logger` is still `undefined` there. TypeScript flags the direct form `ready = this.logger !== undefined` (error TS2729, "used before its initialization"), but it cannot see through the method call, so that version compiles and is wrong at runtime. | Whoever assumes constructor params are available "from the top" of the class |

## 8. 🧠 Senior engineer lens

**Composition over inheritance.** Nest itself shows this: services don't `extends LoggerService`, they **receive** a logger in the constructor. Easier to swap, test, and understand. Inheritance is for "is a" (an `UpdateUserDto` *is a* partial `CreateUserDto`); collaborators are for "uses a".

**Know what's runtime and what's compile time.** TS types don't validate incoming JSON, `private` does not hide anything from `JSON.stringify`, and `implements` promises nothing once compiled. A lot of backend bugs come from assuming a type annotation protects you at runtime (you'll see this again in Pipes, note 07).

**When in doubt, read the compiled JS in `dist/`.** It's the truth. Every claim in section 4.2 came from there, and it is how you settle any argument about field order, decorators or what `private` really does.

**One object, many requests.** Because Nest makes one instance of each service and reuses it, a field is shared state across every request the server ever handles. That is the subject of note 04, and it is the single most important consequence of "data lives on the object".

## 9. 🔗 Connects to
- [03 — DI](03-modules-controllers-providers-di.md): who calls `new` on your classes
- [04 — Shared state](04-requests-shared-state-event-loop.md): fields vs local variables across requests

## 10. ✍️ In my own words
> _(write here)_

## 11. 🛠️ Practice

In a scratch file `practice/classes.ts`, run with `npx tsx practice/classes.ts`:

1. Write `createWallet(owner)` as a **factory function** with `deposit(amount)` and `balance()`.
2. Rewrite it as `class Wallet` with a **parameter property** for `owner`.
3. Break it on purpose: store `const fn = wallet.deposit; fn(10);` and read the error.
4. Fix it **two different ways**.
5. Make `balance` truly private at runtime.

<details><summary>Hints</summary>

- Step 4: an arrow wrapper at the call site, or define `deposit = (amount: number) => {...}` as an arrow **field**. What's the memory trade-off of the second one? (Look at 4.3.)
- Step 5: `#balance`. Then try `console.log(wallet)` and compare with a `private` field.

</details>

## 12. ❓ Quiz

**Q1.**
```ts
class Cart {
  items: string[] = [];
  add(item: string) { this.items.push(item); }
}
const a = new Cart();
const b = new Cart();
a.add('shoe');
console.log(b.items.length);
```
- A) 1, fields are shared like methods on the prototype
- B) 0, each `new` runs the field initializer and creates a fresh array
- C) `undefined`
- D) TypeError

<details><summary>Answer</summary>

**B.** Methods are shared (prototype); **fields are per object**. The initializer `= []` runs on every `new`.
It would be `1` only if the array were `static items = []` or a variable outside the class. Both are shared state (note 04).

</details>

**Q2.**
```ts
class Greeter {
  name = 'saim';
  hi() { return 'hi ' + this.name; }
}
const fn = new Greeter().hi;
fn();
```
- A) `'hi saim'`
- B) `'hi undefined'`
- C) TypeError: Cannot read properties of undefined (reading 'name')
- D) `'hi '`

<details><summary>Answer</summary>

**C.** `this` depends on the call. `fn()` has nothing before the dot, and class bodies are strict mode, so `this` is `undefined`.
Real-life version: `@Get() handler() { return users.map(this.toDto); }`. Crashes at request time, not at startup.

</details>

**Q3.**
```ts
@Injectable()
export class ReportService {
  constructor(private readonly apiKey: string, private readonly logger: Logger) {}
}
// somewhere: console.log('service state', reportService);
```
What's the problem a senior would flag?

- A) None, `private` hides `apiKey`
- B) Logging the object prints `apiKey` in plain text; `private` is compile-time only. Also, Nest can't inject a plain `string` by type.
- C) `readonly` makes logging impossible
- D) Only a performance issue

<details><summary>Answer</summary>

**B.** Two issues: (1) `private` isn't runtime protection, so secrets end up in logs, and log systems are often widely readable.
(2) Nest resolves constructor params **by their class type**. `string` isn't a class, so you'd need `@Inject('API_KEY')` with a custom provider
or, better, a `ConfigService` (Day 7/13).

</details>

**Q4.** 10,000 objects, each with 5 methods. How many function objects are in memory: factory function (object literal methods) vs class?

- A) Same for both
- B) Factory: ~50,000 · Class: 5
- C) Factory: 5 · Class: ~50,000
- D) Depends on the V8 version only

<details><summary>Answer</summary>

**B.** Class methods live once on the prototype. Object-literal methods are created per call.
In Nest this rarely matters for services (there's only one object), but it matters for things created per request or per row (entities, DTOs).

</details>

**Q5.**
```ts
@Injectable()
export class ReportService {
  constructor(private readonly logger: Logger) {}
  private readonly ready = this.check();
  private check() { return this.logger !== undefined; }
}
```
Nest creates it with `new ReportService(logger)`. What is `ready`?

- A) `true`, the constructor runs first and stores `logger`
- B) `false`, field initializers run before the constructor body, so `this.logger` is still `undefined` when `check()` runs
- C) A compile error: fields cannot call methods
- D) `true`, because parameter properties are assigned before any field

<details><summary>Answer</summary>

**B.** Look at the compiled output in section 4.2: the parameter property becomes a bare field declaration (`logger;`), then the constructor body assigns it. All field initializers run in written order **before** the constructor body, and at that moment `this.logger` is `undefined`, so `check()` returns `false`. TypeScript would have caught the direct form `ready = this.logger !== undefined` (error TS2729, "Property 'logger' is used before its initialization"), but it cannot see through a method call, so this version compiles and is silently wrong. The fix is to compute `ready` inside the constructor body, or turn it into a method that runs when asked.

</details>
