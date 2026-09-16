# 02 — JS Classes, Objects & `this`

> 📍 **Where on the Big Map:** under everything. Every controller, service, filter, interceptor, guard and pipe is a class.
> 🎥 **Video:** used from 00:11:48 onwards (not explained in the video)

## 1. The problem (why classes exist)

You already make objects with factory functions:

```js
function createUser(name) {
  return {
    name,
    greet() { return "Hi, I'm " + this.name; },
  };
}
```

A class is **another way to write a function that makes objects**, with a few extras:
methods are shared instead of copied, inheritance (`extends`) is built in, and **frameworks can read information about it** (decorators, parameter types).
That last point is why Nest is class-based.

## 2. Mental model

```
class       = the cookie cutter (a recipe for objects)
new         = pressing the cutter into dough → an actual cookie (object in memory)
constructor = decorating the fresh cookie (putting starting values on it)
this        = "the cookie I'm working on right now"
field       = something stored ON the cookie
method      = something every cookie can do (shared, stored once on the cutter)
```

## 3. How it works behind the scenes

### 3.1 "Creating an object" = using a piece of memory

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

Variables hold an **address**. `new` makes a **new** piece of memory.

### 3.2 What `new User('saim')` really does

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

⚠️ Verified from our own compiled code (`dist/user/user.service.js`): **fields first, then constructor body.**

### 3.3 Why you must write `this.name = name`

In functional code, **closures** remember variables:

```js
function createCounter(start) {
  let count = start;
  return { inc() { count++; } };     // inc "sees" count, closure ✅
}
```

In a class, methods are **not inside** the constructor, so they can't see its variables:

```js
class Counter {
  constructor(start) { /* `start` dies when this function ends */ }
  inc() { start++; }                  // ❌ ReferenceError
}
```

The **object** is the only thing that survives, so you store data on it and read it back via `this`:

```js
class Counter {
  constructor(start) { this.count = start; }  // move from temporary variable → object
  inc() { this.count++; }                      // read from object
}
```

Why not automatic? Not every parameter should be stored: some are only used to compute something (`this.total = price * qty`) or validated and thrown away.

### 3.4 Methods live on the prototype (stored once)

```
 User.prototype:  { greet: ƒ }      ← ONE greet function in memory
        ▲             ▲
        │             │
   userA {name}   userB {name}      ← each object only stores its own data
```

`userA.greet()` → JS looks on `userA`, doesn't find `greet`, walks up to `User.prototype`, finds it, and calls it with `this = userA`.
Factory functions returning object literals create a **new copy** of every method per object.

### 3.5 `this` is decided by HOW you call, not where it's written

| Call style | `this` is |
|---|---|
| `obj.method()` | `obj` (the thing before the dot) |
| `const f = obj.method; f()` | `undefined` (class code is strict mode) → crash |
| `new Thing()` | the brand-new object |
| arrow function `() => this.x` | **no own `this`**; uses the `this` of the surrounding code |

This is why `this.users.find((u) => ...)` works fine inside a method: the arrow doesn't mess with `this`.

### 3.6 TypeScript extras you'll see in Nest

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

| Keyword | Meaning | Exists at runtime? |
|---|---|---|
| `private` | only this class's code may use it | ❌ TS check only. It's a normal property in JS. (`#field` is real runtime privacy.) |
| `readonly` | can't reassign after construction | ❌ TS check only |
| `: UserLoggerService` | the type | ❌ erased... **except** Nest keeps constructor param types via `emitDecoratorMetadata` (note 03) |
| `extends` | inherit fields + methods from another class | ✅ |
| `implements NestInterceptor` | "I promise to have the methods this interface lists" | ❌ TS check only |

## 4. In our project

- [src/user/user.service.ts](../src/user/user.service.ts): parameter property, fields, `this`, compiled-output walkthrough
- [src/user/dto/update-user.dto.ts](../src/user/dto/update-user.dto.ts): `extends`
- [src/utils/transform.interceptor.ts](../src/utils/transform.interceptor.ts): `implements` (next topic)

## 5. ❌ How NOT to do it

| Don't | Why |
|---|---|
| Pass a method as a callback: `arr.map(this.format)` | `this` is lost inside `format` → crash. Use `arr.map((x) => this.format(x))`. |
| Forget `private`/`readonly` on a constructor param and still use `this.x` | The value was never stored. TS error (or `undefined` in plain JS). |
| Rely on `private` to hide secrets | It's compile-time only. `console.log(service)` prints "private" fields, **including API keys** → leaked into logs. |
| Deep inheritance chains (`A extends B extends C extends D`) | Changing D breaks A in surprising ways. Prefer composition: inject what you need (that's what DI is). |

## 6. 🧠 Senior engineer lens

- **Composition over inheritance.** Nest itself shows this: services don't `extends LoggerService`, they **receive** a logger in the constructor.
  Easier to swap, test, and understand.
- **Know what's runtime and what's compile time.** TS types don't validate incoming JSON. A lot of backend bugs come from
  assuming a type annotation protects you at runtime (you'll see this again in Pipes).
- When in doubt, **read the compiled JS** in `dist/`. It's the truth.

## 7. 🔗 Connects to
- [03 — DI](03-modules-controllers-providers-di.md): who calls `new` on your classes
- [04 — Shared state](04-requests-shared-state-event-loop.md): fields vs local variables across requests

## 8. ✍️ In my own words
> _(write here)_

## 9. 🛠️ Practice

In a scratch file `practice/classes.ts`, run with `npx tsx practice/classes.ts`:

1. Write `createWallet(owner)` as a **factory function** with `deposit(amount)` and `balance()`.
2. Rewrite it as `class Wallet` with a **parameter property** for `owner`.
3. Break it on purpose: store `const fn = wallet.deposit; fn(10);` and read the error.
4. Fix it **two different ways**.
5. Make `balance` truly private at runtime.

<details><summary>Hints</summary>

- Step 4: an arrow wrapper at the call site, or define `deposit = (amount: number) => {...}` as an arrow **field**. What's the memory trade-off of the second one? (Look at 3.4.)
- Step 5: `#balance`. Then try `console.log(wallet)` and compare with a `private` field.

</details>

## 10. ❓ Quiz

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
