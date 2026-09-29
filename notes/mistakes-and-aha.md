# Mistakes & Aha Moments

> Every wrong quiz answer and every "ohhh, THAT's how it works" goes here.
> Format: what I thought → what's actually true → why I got confused.
> Re-read this before every checkpoint day.

---

## 2026-09-15 · Classes

**💡 Aha: the constructor does not create the object.**
- Thought: the constructor "makes" the object.
- Actually: `new` creates the empty object. The constructor only **fills it in** (initializes the fields).

**💡 Aha: `private readonly x: T` in the constructor is not empty code.**
- TypeScript secretly writes `this.x = x` for me. Without `private`/`public`/`readonly`, the parameter
  is just a temporary variable that dies when the constructor ends.

**🔧 Correction (Claude got it wrong first):** order inside `new`
- First explanation said: constructor assignment runs, then field initializers.
- Real compiled JS (`dist/user/user.service.js`): **fields are set up first** (in written order), **then** the constructor body runs.
- Lesson: when unsure, **read the compiled output**. `pnpm build` → open `dist/`.

## 2026-09-16 · Shared state

**💡 Aha: fields are not "global". They're per-object.**
- They *feel* shared because Nest creates **one** object and gives it to everyone.
- `new UserService()` twice → two separate `users` arrays.

**💡 Aha: sharing one service object ≠ sharing people's data.**
- The object is the **worker** (like one bank teller). The data each person gets depends on **what their request carries**
  (id, token) and **what the DB returns for that**.
- The real danger: storing per-request data (like `this.currentUser`) on the shared object.

## 2026-09-18 · Validation

**💡 Aha: `dto: CreateUserDto` checks nothing.** TypeScript types are gone at runtime. The decorators + ValidationPipe do the checking.

**⚠️ Found in my own code: mass assignment.** `POST { name, email, isAdmin: true }` returned 201 and `isAdmin` was saved,
because ValidationPipe had no `whitelist` and the service spread `...dto`. Validation only checks fields it has rules for; it doesn't remove the others.

**⚠️ Found in my own code: `extends` inherits rules too.** `UpdateUserDto extends CreateUserDto` made `email` required on `PUT`. → `PartialType`.

**🔧 Setup mistake:** ran `pnpm add` / `nest g` in the parent folder `nestjsmastery/` instead of `nestjsmasterycourse/`.
It still worked locally only because Node searches parent folders for packages. A fresh clone from GitHub would break.
Lesson: always check `pwd` before installing, and read `package.json` after.

**🔧 Tests were broken from day 1 (not my code):** Nest 12 packages are **ES modules only**. Jest normally loads files with
`require()` (CommonJS), which can't load ESM on Node < 24.9 → "Must use import to load ES Module". Fix: run Jest in ESM mode
(`extensionsToTreatAsEsm`, ts-jest `useESM`, and `import { jest } from '@jest/globals'` in specs). The generated specs also
failed with DI errors: a test module must **provide every dependency** (real or fake via `useValue`), same as a real module.

## 2026-09-25 · Notes audit

**🔧 Correction (Claude got it wrong first):** note 10 said the database "refuses to delete a coffee that still has links".
Checked with `\d coffee_flavors`: TypeORM created the link table's foreign keys with `ON DELETE CASCADE`, so deleting a
coffee **also deletes its link rows**, silently. The "refuse" behavior is the other option (`RESTRICT`), and you choose
between them. Lesson: "the database enforces it" is only half an answer; ask *which* rule it enforces.

**🔧 Correction:** note 03 said removing `@Injectable()` fails at startup. Checked against the Nest source and a compiled
class: startup succeeds, and the injected field is `undefined` at request time instead. Worse than an error, because
it hides until a request hits it.

**💡 Method:** the whole rewrite pass verified claims by compiling with the project's TypeScript, reading `dist/`,
inspecting `node_modules/@nestjs/core`, and running SQL against the container. Anything not verified is marked
"roughly" in the notes.

## 2026-09-27 · Building blocks (videos 51–60)

**⚠️ A catch-all filter can leak more than no filter at all.** `@Catch()` + `exception.getStatus()` crashes when the
error is a plain `Error`, Express's default handler takes over, and the client gets an HTML page with a full stack
trace and node_modules paths. Rules: never assume the exception type (`instanceof HttpException`), never let a
filter throw.

**⚠️ `exception.message` is not the validation errors.** For a failed DTO it is the string `"Bad Request Exception"`;
the array of field errors lives in `exception.getResponse()`. A filter built on `.message` silently drops them.

**⚠️ The video's `reflector.get(context.getHandler())` is too narrow.** With `@Public()` on a controller class it
returns `undefined` while `getAllAndOverride([handler, class])` returns `true` — following the video exactly would
leave a whole controller denied.

**💡 A global guard doesn't run for unmatched URLs.** `/does-not-exist` → 404, not 401, so the difference tells an
attacker which routes exist.

**💡 Middleware sees 404s; interceptors don't.** Middleware runs before routing, so it can log requests for URLs
that match nothing. An interceptor only runs when a handler was found.

**💡 The timeout consequence, measured:** client got its 408 at t+3.03s; the handler logged that it finished at
t+5.07s. `timeout()` stops the waiting, not the work.

**💡 The course's hand-written ParseIntPipe has the same bug as my old `parseInt`:** `1abc`→1, `3.7`→3, `0x10`→0.
The built-in one checks the shape with `/^-?\d+$/` *before* converting. Validate, then convert.

## 2026-09-29 · Docs, tests, HTTP (videos 61–71 + the 10–12 gap)

**🔴 My unit suite is red and I didn't know.** `pnpm test` → 4 failures, all
`Nest can't resolve dependencies of the CoffeeService (CoffeeRepository, ?)`: `coffee.service.spec.ts` provides a fake
for `Coffee` but not for `Flavor`, which the service started asking for when the many-to-many relation was added.
Lesson: a test file is code too, and it goes stale when a constructor changes.

**🔴 My e2e test passes and it shouldn't.** `createNestApplication()` builds only the module graph, so **nothing in
`main.ts` runs**: no global ValidationPipe, no TransformInterceptor. Measured side by side — the e2e app returns
`"Hello World!"`, the real app returns `{"statusCode":200,"data":"Hello World!","success":true}`. A green tick on a
program no user talks to. Fix: move the globals to `APP_PIPE`/`APP_INTERCEPTOR` so the module graph carries them.

**🔴 `GET /coffee?limit=5&offset=0` → 400 "offset must be a positive number".** The first page of every list is
broken, because `@IsPositive()` means "> 0". And with no parameters the whole table comes back.

**⚠️ `PartialType` from `@nestjs/mapped-types` is invisible to Swagger** — measured `properties: {}` in the generated
docs, while `PartialType` from `@nestjs/swagger` gives the full set. Both my update DTOs use the mapped-types one.

**⚠️ Hand-written docs drift from the validation rules next to them.** Demo: docs said "at least 2 characters" with
example `"Ka"`; the server answered `400 "name must be longer than or equal to 5 characters"`. The CLI plugin exists
because of exactly this.

**💡 Idempotency, measured:** the same `POST /coffee` body twice → ids 7 **and** 8. Three identical `PUT`s → one row.
Three POSTs with one `Idempotency-Key` + a unique constraint → one row, and Postgres raised `duplicate key value
violates unique constraint` for the rest. This is the referee-scores-a-goal-twice problem in the tournament project.

**💡 pnpm skips `pretest`/`posttest` by default** (pnpm 8), so the course's `pretest:e2e` trick silently does nothing
here. Needs `enable-pre-post-scripts=true` in `.npmrc`.

**✅ Both fixed the same day (2026-09-29).** The missing `getRepositoryToken(Flavor)` provider went into
`coffee.service.spec.ts`, and the two globals moved from `main.ts` into `AppModule` as `APP_PIPE` / `APP_INTERCEPTOR`,
so the app an e2e test builds is the app a user gets. `test/app.e2e-spec.ts` now asserts the real envelope
`{statusCode, data, success}`. A third failure appeared while fixing the first — `create()` is called with
`{...dto, flavor: []}` now that flavors are a relation — which is a test correctly reporting a change.
Final: **16/16 unit, 1/1 e2e**, and the running app is byte-identical for real requests.
