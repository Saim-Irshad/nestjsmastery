# 01 — Express vs Nest & Architecture

> 📍 **Where on the Big Map:** everything. Nest *wraps* Express, and every request still goes through Express first.
> 🎥 **Video:** 00:02:26 – 00:11:48

## 1. The problem (why Nest exists)

Express is tiny. Here's a complete API:

```js
const express = require('express');
const app = express();
app.use(express.json());

const users = [{ id: 1, name: 'saim' }];

app.get('/user/:id', (req, res) => {
  const user = users.find((u) => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ message: 'Not found' });
  res.json(user);
});

app.listen(3000);
```

Great for 5 routes. Now imagine **80 routes, 10 developers, 2 years later**:

- Where does logic go? Route file? A `utils` folder? Someone puts DB queries straight into route handlers.
- Every dev validates input differently. Error responses have 4 different shapes, and **your frontend team suffers**.
- `new UserService(new Logger(new Config()))` wiring is hand-written everywhere. Want a fake logger in tests? Good luck.
- Auth checks are copy-pasted into routes. Someone forgets one. Security incident.

Express doesn't stop any of this, because **Express has no opinion about structure**.
Nest's answer: **"Here is ONE way to structure things. Everyone follows it."**

## 2. Mental model

```
Express = a box of LEGO bricks.          You can build anything. Every team builds it differently.
Nest    = LEGO bricks + instruction manual + labelled compartments.
          Still the same bricks (it literally runs Express underneath).
```

Frontend link: **Express is like plain React** (you pick router, state, folder structure).
**Nest is like Angular / Next.js**: opinions, conventions, "put pages here, put API routes there".
(Nest was actually inspired by Angular: modules, decorators, DI.)

## 3. How it works behind the scenes

### How Express works (it's simpler than you think)

```js
// Express's core idea, massively simplified
function express() {
  const stack = [];                          // list of middleware/route functions

  function app(req, res) {                   // the app IS a function
    let i = 0;
    function next() {
      const fn = stack[i++];
      if (fn) fn(req, res, next);            // call the next function in line
    }
    next();
  }

  app.use = (fn) => stack.push(fn);
  app.get = (path, fn) => stack.push((req, res, next) =>
    req.method === 'GET' && matches(path, req.url) ? fn(req, res, next) : next());
  app.listen = (port) => require('http').createServer(app).listen(port);
  return app;
}
```

So Express = **an array of functions + a `next()` that walks through them**. That's it. Pure functional style, which you already know.

### How Nest sits on top

```
main.ts: NestFactory.create(AppModule)
   │
   ├─ creates an Express app internally (via @nestjs/platform-express "adapter")
   ├─ reads @Module decorators → builds all your objects (DI, see note 03)
   ├─ reads @Controller/@Get/@Post decorators → for each route, calls
   │      expressApp.get('/user/:id', nestMadeHandler)
   │
   └─ nestMadeHandler(req, res) is a function Nest writes, that runs:
          guards → interceptors → pipes → YOUR controller method → interceptors → send JSON
          (and exception filters if anything throws)
```

Proof it's Express underneath: `app.getHttpAdapter().getInstance()` returns the actual Express app,
and you can still do `app.use(helmet())` with normal Express middleware.
(Nest can also swap Express for **Fastify**, a faster HTTP library. Your controllers don't change. That's the point of the adapter layer.)

### Architecture: the layers

```
 ┌───────────────────────────────────────────────────────────┐
 │ Controller  = HTTP adapter ("reception desk")             │  knows about: URLs, params, body, status codes
 │   reads the request, calls the service, returns result    │  should NOT know: SQL, business rules
 ├───────────────────────────────────────────────────────────┤
 │ Service     = business logic ("the kitchen")              │  knows about: rules ("max 3 teams per user")
 │   decisions, calculations, calls the DB layer             │  should NOT know: req, res, headers
 ├───────────────────────────────────────────────────────────┤
 │ Data layer  = ORM / repository ("the fridge")             │  knows about: tables, queries
 └───────────────────────────────────────────────────────────┘
```

**Why split?** The same business rule may be triggered from an HTTP route, a cron job, a queue worker, a CLI script, or GraphQL.
If the rule lives in the controller, you copy-paste it. If it lives in the service, everyone calls the same function.

### Feature folders (what Nest pushes you towards)

```
❌ layer-based                      ✅ feature-based (Nest style)
src/                                src/
  controllers/                        user/
    user.controller.ts                  user.module.ts
    hackathon.controller.ts             user.controller.ts
  services/                             user.service.ts
    user.service.ts                     dto/
    hackathon.service.ts              hackathon/
                                        hackathon.module.ts ...
```

Changing "users" touches **one folder**. Deleting a feature = deleting a folder. Teams can own folders.

## 4. In our project

```
src/main.ts           → starts everything (NestFactory)
src/app.module.ts     → root module, imports UserModule
src/user/             → feature folder: module + controller + service + logger + dto
```

## 5. ❌ How NOT to do it

| Don't | Why it hurts |
|---|---|
| Put everything in `AppModule` | No boundaries. After 30 providers nobody knows what depends on what. |
| Fat controllers (DB queries, business rules inside) | Can't reuse the logic outside HTTP; hard to unit-test. |
| `new SomeService()` manually inside classes | Bypasses DI: you get a second instance, can't swap it in tests, and its own dependencies aren't wired. |
| Pass `req`/`res` down into services | Service becomes glued to HTTP; can't call it from a cron job. Pass plain values instead (`userId`, `dto`). |
| Pick Nest for a 1-file webhook / tiny Lambda | Nest has startup cost and boilerplate. Plain Express/Fastify or a function is fine. |

## 6. 🧠 Senior engineer lens

- **Frameworks trade freedom for consistency.** In a team, consistency usually wins. Onboarding is faster when every module looks the same.
- **Nest's "magic" costs something.** Decorators + reflection mean errors like `Nest can't resolve dependencies of X (?)` happen at startup, not compile time. Learn to read them.
- **The layers matter more than the framework.** Controller/Service/Data separation exists in Spring (Java), .NET, Laravel, Django. Learn the *idea*, and you can move between stacks.

## 7. 🔗 Connects to
- [02 — JS Classes](02-js-classes-objects-this.md): Nest is built from classes
- [03 — Modules/Controllers/Providers/DI](03-modules-controllers-providers-di.md): how the layers are wired
- [04 — Shared state](04-requests-shared-state-event-loop.md): what happens once requests flow

## 8. ✍️ In my own words
> _(write here)_

## 9. 🛠️ Practice
Write the **same** `GET /user/:id` + `POST /user` in **plain Express** in a scratch file (`practice/express-users.js`), then compare it line by line with the Nest version.

<details><summary>Hints</summary>

- Express is installed (Nest uses it) but only as a dependency *of* `@nestjs/platform-express`. pnpm doesn't let your code import
  packages you didn't list yourself, so run `pnpm add express` first. (Senior note: that strictness is a feature. It stops
  "works on my machine" bugs from relying on packages you never declared.)
- Run it with `node practice/express-users.js`. The `practice/` folder is outside `src/`, so `nest build` ignores it.
- Answer for yourself: where would validation go? Where would auth go? How would you test it with a fake DB?
- Notice which decisions Express made you take that Nest had already made for you.

</details>

## 10. ❓ Quiz

**Q1.** In an Express app, `services/userService.js` ends with `module.exports = new UserService();`.
Three different route files `require` it. How many `UserService` objects exist?

- A) 3, one per `require`
- B) 1, because Node caches a module after the first `require`
- C) Depends on which route file loads first
- D) A new one per request

<details><summary>Answer</summary>

**B.** Node runs a module file **once** and caches `module.exports`. Every later `require` gets the same object.
So Express apps have singletons too. **What Nest's DI adds is not "singletons", it's automatic wiring and swap-ability**
(e.g. give the controller a fake service in a test without touching its code).

</details>

**Q2.** You need a rule: *"a user can't join more than 3 hackathons"*. Joining can happen via `POST /hackathon/:id/join`
**and** via an admin bulk-import script. Where should the rule live?

- A) In the controller, right after reading the params
- B) In the service method that performs the join
- C) In the DTO class
- D) In a middleware

<details><summary>Answer</summary>

**B.** It's a **business rule**, and it must hold no matter who triggers the join. The import script never goes through the controller or middleware.
A DTO checks the **shape** of input ("is `id` a number?"), not rules that need a DB lookup.

</details>

**Q3.** Your team wants to switch Nest from Express to Fastify for performance. Which code is most likely to break?

- A) Services that contain business logic
- B) Controllers using `@Get`, `@Body`, `@Param`
- C) Code that injects `@Res()` and calls Express-specific methods like `res.sendFile()`, or uses Express-only middleware
- D) Module files

<details><summary>Answer</summary>

**C.** Nest's decorators are an abstraction over the HTTP library. Code that reaches **through** the abstraction to Express directly is tied to Express.
Senior habit: stay on the abstraction unless you have a reason, and isolate the places where you don't.

</details>
