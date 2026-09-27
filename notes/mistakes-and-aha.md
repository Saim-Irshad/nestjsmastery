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
