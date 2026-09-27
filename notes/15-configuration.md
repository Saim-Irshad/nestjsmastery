# 15 — Configuration: getting settings out of your code

> 📍 **Where on the Big Map:** SERVER START, before everything. Config decides what the app connects to, so it has to be ready before the first provider is built.
> 📘 **Course:** videos 44 (ConfigModule) · 45 (custom .env paths) · 46 (schema validation) · 47 (ConfigService) · 48 (custom config files) · 49 (namespaces & partial registration) · 50 (async configuration of dynamic modules)
> 🌿 **Branch:** `config`
> Builds on [13 — Custom providers](13-custom-providers.md) and [14 — Dynamic modules](14-dynamic-modules.md).

## 1. The problem

Open `src/app.module.ts:57`. Your database password is sitting in the source code:

```ts
TypeOrmModule.forRoot({
  type: 'postgres',
  host: 'localhost',
  port: 5432,
  username: 'postgres',
  password: 'pass123',     // ← in the code, in git, on GitHub
  database: 'postgres',
  synchronize: true,       // ← must be false in production
}),
```

Four things are wrong with this the moment anyone else is involved:

- **It's in git.** You pushed it to GitHub. For a local Docker password that's harmless; do the same with a real database and you've handed out production access. Deleting the line later doesn't help, because git keeps history.
- **It only fits your machine.** A teammate whose port 5432 is taken has to edit the file, and now everyone's diff contains their own settings.
- **It's the same everywhere.** Your laptop, the test run and the production server need three different databases, and this file can only say one thing.
- **`synchronize: true` is a loaded gun** (note 12): correct locally, catastrophic in production. Right now nothing can tell the difference between the two.

The naive fix is an `if`:

```ts
host: process.env.NODE_ENV === 'production' ? 'prod-db.example.com' : 'localhost',
```

which spreads through the file, still hard-codes production details, and gets worse with every new setting.

## 2. Mental model

**Settings are inputs to the program, like arguments to a function.**

```js
startApp({ dbHost: 'localhost', dbPassword: 'pass123' });   // your laptop
startApp({ dbHost: 'db.internal', dbPassword: '••••••' });  // the server
```

Same program, different inputs. The operating system is what hands them in, through a bag of names and values called the **environment** (`process.env` in Node).

You already know the frontend half of this: `.env` files with `VITE_…` or `NEXT_PUBLIC_…` variables, different values in local and deployed builds. Same idea, with one difference that matters: on the frontend those values end up in the browser bundle, so nothing there is secret. On the server they stay on the server, which is exactly why secrets live here and not there.

## 3. Baby steps

### Step 1 — Naive: hard-coded (where we are now)

`src/app.module.ts:57`. What breaks: everything in section 1.

### Step 2 — Read `process.env` directly

```ts
TypeOrmModule.forRoot({
  host: process.env.DATABASE_HOST,
  port: process.env.DATABASE_PORT,
  password: process.env.DATABASE_PASSWORD,
}),
```

Run it with the values in front of the command:

```bash
DATABASE_HOST=localhost DATABASE_PORT=5432 DATABASE_PASSWORD=pass123 pnpm start:dev
```

Real progress: the secret has left the code, and each machine can pass its own. Four things are still wrong:

- **Typing that line every time is miserable**, so people put it in a shell file and forget it exists.
- **Everything is a string.** `process.env.DATABASE_PORT` is `"5432"`, not `5432`. Some libraries cope, some fail strangely.
- **A typo is silent.** `DATABSE_HOST` gives `undefined`, and the app starts anyway, then fails on the first query with a message that doesn't mention config.
- **Nothing says what's required.** A new developer clones the repo and has to grep for `process.env` to discover what they need.

### Step 3 — Put the values in a file: `.env` + `ConfigModule.forRoot()`

```bash
pnpm add @nestjs/config
```

```
# .env  (in the project root, NOT committed)
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=pass123
DATABASE_NAME=postgres
```

```ts
// src/app.module.ts
imports: [ConfigModule.forRoot(), /* …the rest… */]
```

That one call reads `.env`, parses it, and merges the values into `process.env` before anything else runs. It's a dynamic module (note 14), so it also takes options:

```ts
ConfigModule.forRoot({
  envFilePath: '.environment',      // a different file name
  // envFilePath: ['.env.local', '.env'],   // several; the FIRST match wins
  ignoreEnvFile: true,              // on a server where the platform sets real env vars
})
```

⚠️ **`.env` must never be committed.** Your `.gitignore` already has `.env` on line 42, so you're safe, but check it in every new project before writing a secret into one. The convention that goes with it: commit a **`.env.example`** with the same keys and fake values, so a teammate knows what to fill in.

What's still wrong: you're reading `process.env` from anywhere in the app, and a typo is still silent.

### Step 4 — Ask for config like any other dependency: `ConfigService`

Instead of reaching into a global, inject the thing that holds the settings:

```ts
// the module that needs it
imports: [ConfigModule],        // forRoot() only once, in AppModule; here just ConfigModule

// the service
constructor(private readonly configService: ConfigService) {}

// anywhere in it
const host = this.configService.get<string>('DATABASE_HOST');
const host = this.configService.get<string>('DATABASE_HOST', 'localhost');   // with a fallback
```

Two gains. It's an argument now, so a test can hand over a fake instead of setting environment variables. And `get()` takes a default, so "this setting is optional and falls back to X" is stated in code.

⚠️ **`get<number>('DATABASE_PORT')` still returns a string.** The type parameter tells TypeScript what to expect; it does not convert anything. The course says this explicitly, and it's a classic source of "why is my port `"5432"`". You convert it yourself (step 6 is where that belongs).

What's still wrong: a missing or malformed variable is *still* only discovered when something uses it.

### Step 5 — Refuse to start when config is wrong: validation

```bash
pnpm add joi
```

```ts
import * as Joi from 'joi';

ConfigModule.forRoot({
  validationSchema: Joi.object({
    DATABASE_HOST: Joi.required(),
    DATABASE_PORT: Joi.number().default(5432),
    DATABASE_PASSWORD: Joi.required(),
    NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  }),
}),
```

Now a missing `DATABASE_PASSWORD` **stops the app from starting**, with a message naming the variable. That's the same fail-fast idea as an async factory that can't connect (note 13 step 7b): a failure at deploy time is cheap, and the same failure at 3am, as a 500 on a user's request, is not.

Note `NODE_ENV: valid(...)`: this is the fix for note 13's quiz Q6, where `NODE_ENV=test` silently fell through to the development branch. Unknown values now fail loudly.

⚠️ **The video installs `@hapi/joi`.** That package is deprecated; the current one is plain `joi` (and its types are bundled, so you don't need `@types/hapi__joi` either). Everything else in the video is the same.

### Step 6 — Group settings, and convert them once: custom config files

Scattered `configService.get('DATABASE_HOST')` calls have two problems: the conversion from string happens wherever someone remembers to do it, and the keys are loose strings.

```ts
// src/config/app.config.ts
export default () => ({
  environment: process.env.NODE_ENV || 'development',
  database: {
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),   // converted ONCE, here
  },
});
```

```ts
ConfigModule.forRoot({ load: [appConfig] }),
```

```ts
this.configService.get('database.host');   // dot notation into the nested object
```

A plain factory function that returns an object, run at startup. All the "read the environment, convert it, apply defaults" work lives in one file, and the rest of the app receives finished values.

### Step 7 — Keep a feature's settings next to the feature: namespaces + partial registration

As the app grows, `'database.host'` strings everywhere get fragile. So give each feature its own config object, registered by the module that owns it:

```ts
// src/coffee/config/coffee.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('coffees', () => ({
  foo: process.env.COFFEES_FOO,
}));
```

```ts
// src/coffee/coffee.module.ts
imports: [ConfigModule.forFeature(coffeeConfig)],
```

```ts
// src/coffee/coffee.service.ts
constructor(@Inject(coffeeConfig.KEY) private readonly coffeesConfiguration: ConfigType<typeof coffeeConfig>) {}

this.coffeesConfiguration.foo;      // typed; autocompletes; a typo is a compile error
```

Two things happened there. `registerAs('coffees', …)` names the group. And `coffeeConfig.KEY` is a **token** (note 13 step 5): you inject the config object itself rather than a service you have to ask with strings. `ConfigType<typeof coffeeConfig>` gives it the type of whatever the factory returns, so the compiler now checks your settings.

Same `forRoot` / `forFeature` split as TypeORM (note 14 step 5): root once, feature per module.

### Step 8 — Make import order stop mattering: `forRootAsync`

This is the trap video 50 demonstrates, and it's worth doing yourself. Put `TypeOrmModule.forRoot({ host: process.env.DATABASE_HOST })` **above** `ConfigModule.forRoot()` in the imports array and the app fails: every value is `undefined`.

Why: the object `{ host: process.env.DATABASE_HOST }` is built **at the moment that line is evaluated**, and the lines run top to bottom. `ConfigModule` hasn't loaded `.env` into `process.env` yet.

```js
// the same bug in plain JS
const options = { host: process.env.DATABASE_HOST };   // undefined: nothing has loaded .env yet
loadDotEnv();                                          // too late for the object above
```

Reordering the array fixes it today and breaks again the next time someone reorganises the file. **An app whose correctness depends on the order of an imports array is fragile.** The fix is to stop passing a finished object, and pass a function that Nest calls *after* the container is ready:

```ts
TypeOrmModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    type: 'postgres',
    host: config.get<string>('DATABASE_HOST'),
    port: +config.get<string>('DATABASE_PORT'),      // convert: it's a string
    username: config.get<string>('DATABASE_USER'),
    password: config.get<string>('DATABASE_PASSWORD'),
    database: config.get<string>('DATABASE_NAME'),
    synchronize: config.get('NODE_ENV') !== 'production',
  }),
}),
```

It's the `useFactory` + `inject` pair from note 13 step 7, applied to a module's options. Nest builds `ConfigService` first *because the factory asks for it*, not because of where the line sits. Order stops mattering, which is the actual lesson.

## 4. How it works underneath

`ConfigModule.forRoot()` is a dynamic module returning ordinary providers (note 14 §4). Roughly:

```js
function forRoot(options = {}) {
  const file = options.envFilePath ?? '.env';
  const parsed = options.ignoreEnvFile ? {} : parseEnvFile(file);   // "A=b" lines → { A: 'b' }

  // real environment variables win over the file: the server's values must beat your local ones
  const merged = { ...parsed, ...process.env };

  if (options.validationSchema) {
    const { error, value } = options.validationSchema.validate(merged);
    if (error) throw new Error(`Config validation error: ${error.message}`);   // app never starts
    Object.assign(merged, value);                                             // defaults applied
  }

  Object.assign(process.env, merged);                       // so plain process.env works too
  const loaded = (options.load ?? []).map((factory) => factory());   // step 6 files

  return {
    module: ConfigModule,
    global: options.isGlobal,
    providers: [{ provide: ConfigService, useValue: new ConfigService(merged, loaded) }],
    exports: [ConfigService],
  };
}
```

And the startup order, file by file:

```
 src/main.ts:38            NestFactory.create(AppModule)
   ▼ src/app.module.ts      the imports array is evaluated TOP TO BOTTOM
   │    ConfigModule.forRoot({...})      → reads .env, validates, provides ConfigService
   │    TypeOrmModule.forRootAsync({...}) → returns a FACTORY, not options
   ▼
   container builds providers in dependency order (note 13 §4)
   │    ConfigService first (the factory asks for it)
   │    then the factory runs → real options → connection opens (async, awaited)
   ▼
   routes bound → app.listen()
```

The difference between `forRoot` and `forRootAsync` in one line: **one reads values while the file is being read, the other reads them after the container exists.**

## 5. Functional vs class

```js
// functional: config is an argument, passed down from one place
const config = loadConfig(process.env);
const db = connect(config.database);
const coffeeService = makeCoffeeService(db, config.coffees);
```

```ts
// Nest: config is a provider, asked for by whoever needs it
constructor(private readonly configService: ConfigService) {}
constructor(@Inject(coffeeConfig.KEY) private readonly cfg: ConfigType<typeof coffeeConfig>) {}
```

**What the class version buys:** a service ten layers down gets its settings without every function in between taking a `config` parameter, and tests swap in fake settings by registering a different value under the same name.

**What it costs:** the dependency is less visible (you have to open a file to see what settings it reads), and `ConfigService.get('some.string')` trades compile-time checking for convenience. Step 7's typed namespaces buy that back: it's the functional version's clarity with the class version's reach.

## 6. In my project

- `src/app.module.ts:57` — the hard-coded credentials this whole note is about. Still there; step 8 is the fix.
- `docker-compose.yaml` — `POSTGRES_PASSWORD: pass123`. Whatever the app uses must match what the container was created with, and remember the password is only applied on first creation (note 09 A §3.5).
- `.gitignore:42` — `.env` is already ignored. ✅
- `package.json` — `@nestjs/config` and `joi` are **not installed yet**; step 3 and step 5 install them.
- `synchronize: true` in `app.module.ts` — after step 8 this becomes `config.get('NODE_ENV') !== 'production'`, which is the first time this app can tell environments apart.

## 7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| Commit `.env` with real secrets | The secret is in git history forever; rotating it is the only fix | the whole company, sometimes publicly |
| Hard-code production hosts in an `if` | Production details live in every developer's checkout | security, and whoever edits the wrong branch |
| Read `process.env` deep inside services | Hidden inputs: can't test, can't see requirements, can't reconfigure (note 14 Part A step 2) | whoever tries to reuse or test that service |
| Skip validation | A typo becomes `undefined`, the app starts, and fails later with an unrelated-looking error | users, and you at 3am |
| Trust `get<number>()` to convert | You pass `"5432"` where a number is expected; some libraries silently misbehave | whoever debugs it |
| Depend on imports-array order (`forRoot` reading `process.env`) | Works today, breaks when someone reorders the file | the next person to touch `app.module.ts` |
| Leave `synchronize: true` anywhere but local | A rename drops a column with its data (note 12 B) | customers |
| Log the config object on startup | Passwords and tokens land in log storage, which is widely readable | security |
| Use one `.env` for every environment | Staging ends up pointed at the production database | everyone |
| Put secrets in a Docker image | Anyone who can pull the image has them | security |

## 8. 🧠 Senior engineer lens

- **One build, many environments.** The same artifact should run on your laptop, in CI and in production, with only the environment differing. That's the "twelve-factor" rule, and it's why `NODE_ENV`-shaped `if`s in code are a smell: the *code* shouldn't know where it is.
- **Config and secrets are different.** A port or a feature flag is config; a password or an API key is a secret. Small teams keep both in environment variables; beyond that, secrets move to a manager (AWS Secrets Manager, Vault, Doppler) that supports rotation and access logs. The application-side shape doesn't change.
- **Validate everything at the edge of startup**, the same way a DTO validates the edge of a request (note 07). A config schema is a DTO for your environment.
- **Configuration is a contract with whoever deploys.** `.env.example`, a validation schema with clear messages, and a README section are what turn "it doesn't start" into a five-second fix.
- **Never log it.** Print which *keys* loaded if you must, never the values. Logs get shipped to systems with far looser access than your database.
- **Defaults are dangerous when they're silent.** A default host of `localhost` in production means a service that quietly talks to nothing instead of failing. Default the harmless things; require the important ones.

## 9. 🔗 Connects to
- [13 — Custom providers](13-custom-providers.md): `useFactory` + `inject`, async factories, tokens (`coffeeConfig.KEY`)
- [14 — Dynamic modules & scopes](14-dynamic-modules.md): `forRoot` / `forFeature` / `…Async` are the same pattern
- [09 — Database, Docker & TypeORM](09-database-docker-typeorm.md): the credentials being moved, and the container that must match
- [12 — Indexes & Migrations](12-indexes-migrations.md): `synchronize` finally becomes environment-aware
- Course 2 (Auth): JWT secrets are the next thing that must never be hard-coded

## 10. ✍️ In my own words
> _(mine to write)_

## 11. 🛠️ Practice

Do them in order; each is one step from section 3.

1. **Move the credentials out.** `pnpm add @nestjs/config`, create `.env` with the five database values, add `ConfigModule.forRoot()`, and switch `TypeOrmModule.forRoot` to read `process.env`. Confirm the app still connects. Then confirm `git status` does **not** list `.env`.
2. **Write `.env.example`** with the same keys and fake values, and commit that one.
3. **Break it on purpose.** Rename `DATABASE_PASSWORD` to `DATABASE_PASSWORDD` in `.env`. What error do you get, and at what moment? Now add the Joi schema from step 5 and try again: what changes about *when* you find out?
4. **Prove the order trap.** Move `TypeOrmModule.forRoot(...)` above `ConfigModule.forRoot()` and start the app. Read the failure. Then switch to `forRootAsync` with `inject: [ConfigService]` and move it back and forth: it should work either way.
5. **Make `synchronize` environment-aware**: `config.get('NODE_ENV') !== 'production'`. Then run `NODE_ENV=production pnpm start:dev` and check the log to confirm it didn't try to alter tables.
6. **Namespace something.** Add `src/coffee/config/coffee.config.ts` with `registerAs('coffees', …)`, register it with `ConfigModule.forFeature`, and inject it with `@Inject(coffeeConfig.KEY)`. Then make a typo in a property name and notice the compiler catching it, unlike `get('coffees.foo')`.

<details><summary>Hints</summary>

- 1: `ConfigModule.forRoot()` must be imported before anything that reads `process.env` at evaluation time; that's the trap you'll fix properly in task 4.
- 3: without validation, startup succeeds and the failure appears as a database authentication error. With it, startup stops and names the variable.
- 5: `+config.get('DATABASE_PORT')` or `parseInt(...)`; the value is a string.
- 6: `ConfigType<typeof coffeeConfig>` is the type; `coffeeConfig.KEY` is the token.

</details>

## 12. ❓ Quiz

**Q1.** `TypeOrmModule.forRoot({ host: process.env.DATABASE_HOST })` sits **above** `ConfigModule.forRoot()` in the imports array. What happens and why?

- A) Works: Nest sorts imports by dependency
- B) Every value is `undefined`, because the options object is built while that line is evaluated, top to bottom, before `ConfigModule` has loaded `.env` into `process.env`
- C) Startup error naming the missing variable
- D) Works in development, fails in production

<details><summary>Answer</summary>

**B.** And the real lesson isn't "reorder the array": it's that correctness should not depend on array order. `forRootAsync` with `inject: [ConfigService]` makes Nest build the config first *because the factory asks for it*.

</details>

**Q2.** `const port = this.configService.get<number>('DATABASE_PORT');` — what is `port` at runtime?

- A) A number, because of `<number>`
- B) The string `"5432"`: the type parameter only tells TypeScript what to expect, and environment variables are always strings
- C) `undefined` unless a default is given
- D) A number only when a Joi schema coerced it

<details><summary>Answer</summary>

**B** in the plain case. Worth knowing the nuance: a Joi schema with `Joi.number()` does coerce the *validated* value, which is one more reason to convert in one place (step 6) rather than trusting each call site.

</details>

**Q3.** A teammate commits `.env` with the production database password "so the deploy works". You remove the file and commit again. Is the secret safe?

- A) Yes, the file is gone
- B) No: git keeps the whole history, so the password is still in every clone and on GitHub. It has to be rotated, and the repo history scrubbed
- C) Yes, if the repo is private
- D) Yes, after a force-push

<details><summary>Answer</summary>

**B.** "Delete and commit" is the most common wrong answer to a leaked secret. The only real fix is rotating the credential, because you must assume it was copied.

</details>

**Q4.** No validation schema. `.env` says `DATABSE_HOST=localhost` (typo). When do you find out?

- A) At startup, with a clear error
- B) Not at startup: the app boots, and the failure appears on the first database call as an authentication or connection error that doesn't mention config
- C) TypeScript catches it
- D) Never

<details><summary>Answer</summary>

**B.** This is the whole argument for the Joi schema: turn a confusing runtime failure into a startup failure that names the variable.

</details>

**Q5.** Why `ConfigModule.forFeature(coffeeConfig)` with `registerAs`, instead of adding the keys to the root config?

- A) It's faster
- B) The settings live next to the feature that owns them, and injecting `coffeeConfig.KEY` with `ConfigType` gives a typed object, so a misspelled property is a compile error instead of `undefined` from `get('coffees.fooo')`
- C) Root config can't hold nested objects
- D) It's required for any module outside AppModule

<details><summary>Answer</summary>

**B.** Same root/feature split as TypeORM (note 14), plus the typing benefit, which is the part that pays off as the number of settings grows.

</details>

**Q6.** In production you run with `ignoreEnvFile: true` and set variables through the hosting platform. A required one is missing. With the Joi schema in place, what happens, and why is that the desired outcome?

- A) The app starts and uses a default
- B) The app refuses to start and names the variable, so the bad deploy is caught at rollout instead of serving broken requests to users
- C) Nest falls back to `.env`
- D) Only the module needing it fails

<details><summary>Answer</summary>

**B.** A deploy that fails loudly is cheap; a deploy that half-works is expensive. Same principle as an async provider that can't connect (note 13 step 7b).

</details>
