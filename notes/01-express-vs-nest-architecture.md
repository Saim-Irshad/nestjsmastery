# 01 — Express vs Nest & Architecture

> 📍 **Where on the Big Map:** everything. Nest *wraps* Express, and every request still goes through Express first.
> 📘 **Course:** videos 1–6 (intro, installing the CLI, generating the app, what's inside it, Insomnia, dev mode) · 🎥 **YouTube video:** 00:02:26 – 00:11:48 · 🌿 **Branch:** `main`

## 1. The problem

This project has a `user` feature: `GET /user?name=saim`, `GET /user/:id`, `POST /user`, `PUT /user/:id`. Before Nest, the tool for this was Express, and Express is tiny. Here is a complete, working API for the first two routes:

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

app.post('/user', (req, res) => {
  const newUser = { id: users.length + 1, ...req.body };
  users.push(newUser);
  res.status(201).json(newUser);
});

app.listen(3000);
```

Nothing is wrong with this for five routes. Now picture the same app with **80 routes, 10 developers, 2 years later**. This is what happens, and none of it is a made-up story:

- Nobody agreed where logic goes. One developer puts the "find the user" rule in the route file, another in a `utils` folder, a third writes database queries straight inside the route handler.
- Every developer validates input their own way. The `POST /user` handler above does `...req.body`, so a body of `{ "name": "hacker", "isAdmin": true }` gets stored with `isAdmin: true`. (This exact bug existed in this repo's Nest version too, before it was fixed on 2026-09-18; see `src/user/user.service.ts:138-151`.)
- Error responses come out in four different shapes: `{ message }` here, `{ error }` there, a plain string somewhere else. **Your frontend team is the one who suffers**, because they have to handle every shape.
- Wiring like `new UserService(new Logger(new Config()))` is hand-written in each place that needs it. Want a fake logger in a test? You have to rebuild the whole chain by hand.
- The auth check is copy-pasted into each route. Someone forgets one route. That is a security incident.

Express does not stop any of this, because Express has no opinion about structure. It gives you a router and gets out of the way. Nest's answer is the opposite: **"Here is ONE way to structure things. Everyone follows it."**

## 2. Mental model

```
Express = a box of LEGO bricks.          You can build anything. Every team builds it differently.
Nest    = LEGO bricks + instruction manual + labelled compartments.
          Still the same bricks (it literally runs Express underneath).
```

Frontend comparison: **Express is like plain React.** You pick the router, the state library and the folder structure yourself. **Nest is like Angular or Next.js:** it has opinions and conventions, "put pages here, put API routes there". Nest was in fact inspired by Angular, which is where its modules, decorators and dependency injection come from.

## 3. Baby steps

The idea is easier to see if you grow into it the way a team actually would.

### Step 1: naive. Everything inside the route handler

```js
app.post('/hackathon/:id/join', (req, res) => {
  const userId = req.body.userId;
  const joined = joins.filter((j) => j.userId === userId);
  if (joined.length >= 3) {
    return res.status(400).json({ error: 'max 3 hackathons' });   // business rule, inline
  }
  joins.push({ userId, hackathonId: Number(req.params.id) });
  res.status(201).json({ ok: true });
});
```

**What breaks:** two weeks later an admin needs a bulk-import script that joins 500 users to a hackathon. The script does not go through HTTP, so it cannot reuse this handler. The developer copies the "max 3" check into the script. A month later the rule changes to "max 5" and only one of the two copies gets updated. Also notice the error shape: this handler sends `{ error }`, while the `GET /user/:id` handler above sends `{ message }`. The frontend now needs two error parsers.

### Step 2: better. Pull the logic into its own function, keep the handler thin

```js
// hackathon.service.js
function createHackathonService(joins) {
  return {
    join(userId, hackathonId) {
      const joined = joins.filter((j) => j.userId === userId);
      if (joined.length >= 3) throw new Error('max 3 hackathons');
      joins.push({ userId, hackathonId });
    },
  };
}

// routes.js
app.post('/hackathon/:id/join', (req, res) => {
  try {
    hackathonService.join(req.body.userId, Number(req.params.id));
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});
```

Now the import script calls `hackathonService.join(...)` and the rule lives in one place. The handler only reads the request and translates the result into HTTP.

**What is still wrong:** somebody has to build `hackathonService`, and it needs a `joins` store, which needs a database connection, which needs config. So `main.js` fills up with lines like `const config = loadConfig(); const db = connect(config); const joins = createJoinsRepo(db); const hackathonService = createHackathonService(joins);`, in the right order, and every time a service gets a new dependency that file changes too. The `try/catch` that turns errors into `400` is copied into every handler. And the layout of folders is still whatever each developer felt like that day.

### Step 3: what a senior does. Agree on the structure and let a machine enforce it

A senior team decides three things and writes them down:

1. **Three layers, each with a job.** The reception desk reads the request and returns the response and knows nothing about business rules. The kitchen holds the rules and knows nothing about HTTP. The fridge talks to the database.
2. **One folder per feature**, not one folder per layer, so "everything about users" lives in `user/`.
3. **One place** that builds all the objects, **one place** that validates input, **one place** that turns errors into HTTP responses.

You could enforce this with a code review checklist. Or you could pick a framework where the structure is not a convention but the only way the code runs. That is Nest. The same route in this repo looks like this (`src/user/user.controller.ts:99-102`):

```ts
@Get('/:id')
getUserbyId(@Param('id', ParseIntPipe) id: number) {
  return this.userService.getUserById(id);
}
```

The reception desk is a method on a class labelled `@Controller('user')`. The kitchen is `UserService`. Turning `"2"` into `2` and rejecting `"1abc"` is done by `ParseIntPipe` at the door instead of inside the handler (before that pipe was added, the service did `parseInt(id)`, and because `parseInt("1abc") === 1`, `GET /user/1abc` returned user 1; see `src/user/user.controller.ts:93-98`). Whatever the method returns becomes the JSON response; whatever it throws becomes an HTTP error with one agreed shape. Nobody has to remember to do any of it.

That agreed structure, enforced by the framework, is what people mean when they call Nest "opinionated". The reception desk is the **controller**, the kitchen is the **service**, and the fridge is the **repository** (or data layer).

## 4. How it works underneath

### How Express works (it is simpler than you think)

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

So Express is **an array of functions plus a `next()` that walks through them**, in the order you registered them. That is the whole thing. It is pure functional style, which you already know: `app.use` pushes a function, and every request runs down the array until one of them sends a response.

### How Nest sits on top

```
main.ts: NestFactory.create(AppModule)
   │
   ├─ creates an Express app internally (via @nestjs/platform-express, the "adapter")
   ├─ reads @Module decorators → builds all your objects (DI, see note 03)
   ├─ reads @Controller/@Get/@Post decorators → for each route, calls
   │      expressApp.get('/user/:id', nestMadeHandler)
   │
   └─ nestMadeHandler(req, res) is a function Nest writes, that runs:
          guards → interceptors → pipes → YOUR controller method → interceptors → send JSON
          (and exception filters if anything throws)
```

In plain JS, the handler Nest writes for `GET /user/:id` is roughly this:

```js
expressApp.get('/user/:id', async (req, res) => {
  try {
    const id = await parseIntPipe.transform(req.params.id);   // "2" → 2, "1abc" → throws 400
    const result = await userController.getUserbyId(id);      // your method, on the ONE controller object
    res.status(200).json(result);                             // your return value becomes the response
  } catch (err) {
    sendAsHttpError(err, res);                                // exception filters (note 05)
  }
});
```

Proof that it is Express underneath: `app.getHttpAdapter().getInstance()` returns the actual Express app, and you can still do `app.use(helmet())` with normal Express middleware. Nest can also swap Express for **Fastify**, a faster HTTP library, and your controllers do not change. That swappable layer between Nest and the HTTP library is the point of the adapter.

### The flow of one request through this repo

```
 GET /user/2
   │
   ▼
 src/main.ts:38        NestFactory.create(AppModule) built everything at startup, once
   │
   ▼
 Express (inside @nestjs/platform-express)   matches 'GET /user/:id' → nestMadeHandler
   │
   ▼
 src/main.ts:54        global ValidationPipe runs (note 07)
 src/user/user.controller.ts:100   ParseIntPipe: "2" → 2
   │
   ▼
 src/user/user.controller.ts:100   userController.getUserbyId(2)          ← reception desk
   │
   ▼
 src/user/user.service.ts:121      userService.getUserById(2)             ← kitchen
   │                                (finds the user in this.users, or throws NotFoundException)
   ▼
 src/main.ts:69        TransformInterceptor wraps the return value (note 06)
   │
   ▼
 { statusCode: 200, data: { id: 2, name: 'Jane Smith' }, success: true }  → client
```

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

**Why split at all?** The same business rule may be triggered from an HTTP route, a cron job, a queue worker, a CLI script, or GraphQL. If the rule lives in the controller, you copy-paste it (step 1 above). If it lives in the service, everyone calls the same function.

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

Changing "users" touches **one folder**. Deleting a feature means deleting a folder. Teams can own folders.

## 5. Functional vs class

The same route, both ways:

```js
// Express: a function, and you wire everything yourself
const userService = createUserService(createLogger());

app.get('/user/:id', (req, res) => {
  const id = Number(req.params.id);
  res.json(userService.getUserById(id));
});
```

```ts
// Nest: a class with labels, and Nest wires everything for you
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('/:id')
  getUserbyId(@Param('id', ParseIntPipe) id: number) {
    return this.userService.getUserById(id);
  }
}
```

They do the same thing. The difference is who does the work around the handler.

| | Function (Express) | Class (Nest) |
|---|---|---|
| Who builds `userService`? | You, in `main.js`, in the right order | Nest, by reading the constructor (note 03) |
| Where is the URL? | In the `app.get(...)` call | In a label stuck on the method (`@Get`) |
| Who reads `req.params.id`? | You | Nest, because `@Param('id')` says where the value comes from |
| Who sends the response? | You (`res.json`) | Nest, from the return value |
| Errors → HTTP? | Your `try/catch`, per handler | One place for the whole app (note 05) |

**What the class version buys:** a class is a value that survives at runtime, so there is somewhere to stick labels (the route path, where each parameter comes from) and a constructor that *declares* what the class needs. That declaration is what lets a machine build the objects, in the right order, with fakes in tests. One controller object is created and shared by every request.

**What it costs:** you need to know the `this` rules (note 02). Mistakes in wiring show up as startup errors like `Nest can't resolve dependencies of X (?)` instead of compile errors. There is more ceremony per route, and decorators plus reflection are a layer of "magic" you have to be able to see through, which is what note 03 is for.

**When to pick which:** one-file webhook, a tiny Lambda, a throwaway script: a function is fine and Nest's startup cost is not worth it. Anything with more than a handful of routes and more than one developer: the agreed structure pays for itself within weeks.

## 6. In my project

- `src/main.ts:22-74` is `bootstrap()`, the only plain function in the app. `NestFactory.create(AppModule)` at `src/main.ts:38` is where the Express app is created and all the objects are built. `src/main.ts:54` and `src/main.ts:69` register the global validation pipe and the response-wrapping interceptor, the two "one place for the whole app" decisions from step 3. `src/main.ts:73` starts listening.
- `src/app.module.ts:39-95` is the root module: the table of contents. It imports `UserModule` and `CoffeeModule`.
- `src/user/` is a feature folder: `user.module.ts` (the list), `user.controller.ts` (reception desk, `src/user/user.controller.ts:23`), `user.service.ts` (kitchen, `src/user/user.service.ts:15-16`), `user.logger.service.ts`, `dto/`.
- `src/coffee/` is the second feature folder, with a real database behind it (`src/coffee/coffee.module.ts:23`, the fridge is a TypeORM repository, note 09).
- The `/user/1abc` bug and its fix, documented at `src/user/user.controller.ts:93-98`: converting input belongs at the edge (the pipe), not in the kitchen.

## 7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| Put everything in `AppModule` | No boundaries. After 30 providers nobody knows what depends on what. | The next developer, who cannot tell what is safe to change |
| Fat controllers (database queries and business rules inside) | The logic cannot be reused outside HTTP and is hard to unit-test. | The team writing the cron job or import script, who copy-paste the rule and later diverge |
| `new SomeService()` by hand inside classes | You bypass DI: a second instance appears, it cannot be swapped in tests, and its own dependencies are not wired. | Whoever debugs "why does my service see stale data" (note 03, note 04) |
| Pass `req`/`res` down into services | The service is glued to HTTP; it cannot be called from a cron job. Pass plain values instead (`userId`, `dto`). | The developer who needs the rule outside HTTP |
| Pick Nest for a 1-file webhook or a tiny Lambda | Nest has startup cost and boilerplate. Plain Express/Fastify or a bare function is fine. | You, paying cold-start time on every invocation |

## 8. 🧠 Senior engineer lens

**Frameworks trade freedom for consistency.** In a team, consistency usually wins. Onboarding is faster when every module looks the same, code review is faster when there is one right place for each kind of code, and the frontend team is happier when every error has the same shape.

**Nest's "magic" costs something.** Decorators and reflection mean that a wiring mistake shows up as `Nest can't resolve dependencies of X (?)` at startup, not as a compile error. Learn to read those messages; they are precise once you know the vocabulary (note 03).

**The layers matter more than the framework.** Controller / service / data separation exists in Spring (Java), .NET, Laravel, Django. Learn the *idea*, and you can move between stacks. The framework is the spine of this course, not the goal.

**Express is still running.** Every request goes through Express's array of functions before Nest sees it, and `app.use(...)` in `main.ts` is plain Express middleware. When something behaves strangely at the HTTP edge (body parsing, CORS, raw bodies for webhooks), the answer is usually in Express, not in Nest.

## 9. 🔗 Connects to
- [02 — JS Classes](02-js-classes-objects-this.md): Nest is built from classes
- [03 — Modules/Controllers/Providers/DI](03-modules-controllers-providers-di.md): how the layers are wired
- [04 — Shared state](04-requests-shared-state-event-loop.md): what happens once requests flow

## 10. ✍️ In my own words
> _(write here)_

## 11. 🛠️ Practice
Write the **same** `GET /user/:id` + `POST /user` in **plain Express** in a scratch file (`practice/express-users.js`), then compare it line by line with the Nest version.

<details><summary>Hints</summary>

- Express is installed (Nest uses it) but only as a dependency *of* `@nestjs/platform-express`. pnpm doesn't let your code import
  packages you didn't list yourself, so run `pnpm add express` first. (Senior note: that strictness is a feature. It stops
  "works on my machine" bugs from relying on packages you never declared.)
- Run it with `node practice/express-users.js`. The `practice/` folder is outside `src/`, so `nest build` ignores it.
- Answer for yourself: where would validation go? Where would auth go? How would you test it with a fake DB?
- Notice which decisions Express made you take that Nest had already made for you.

</details>

## 12. ❓ Quiz

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

**Q4.** A developer ports a Nest controller method back to plain Express and writes:

```js
app.get('/user/:id', (req, res) => {
  const user = users.find((u) => u.id === Number(req.params.id));
  return user;
});
```

What does the client see?

- A) The user as JSON, Express serialises return values
- B) `undefined` as the body
- C) Nothing. The request hangs until the client gives up
- D) A 500 error

<details><summary>Answer</summary>

**C.** Express ignores whatever a handler returns. Look at the sketch in section 4: `fn(req, res, next)` is called and the result is thrown away. Nothing calls `res.json`, nothing calls `next()`, so the response is never sent and the connection stays open until the client times out. At 3am this looks like "the API is down" while the server is perfectly healthy. In Nest, the handler that Nest generates is the thing that calls `res.json(result)` with your return value, which is why returning works there and not here.

</details>

**Q5.** In plain Express, the auth check is registered **after** the route:

```js
app.get('/user/:id', getUserHandler);
app.use(requireLogin);
```

Does `GET /user/:id` require a login?

- A) Yes, `app.use` middleware always runs first
- B) Yes, Express sorts middleware before routes
- C) No, the route handler runs first and sends the response, so `requireLogin` never runs for it
- D) It throws at startup because middleware must come before routes

<details><summary>Answer</summary>

**C.** Express is an array walked in registration order (section 4). `getUserHandler` is at index 0, sends the response and never calls `next()`, so index 1 is never reached. The route is wide open and nothing warns you. This is one of the "forgets one route → security incident" cases from section 1, and it is why Nest moves auth into guards that are attached to the route itself (the guards note, later in the course) instead of relying on the order of lines in a file.

</details>
