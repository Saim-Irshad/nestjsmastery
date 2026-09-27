# Glossary: the words, in plain language

> How to use this: when a video says a word and your brain stalls, look it up here, get the idea in one breath,
> then go back to the video. Every entry says the **idea first**, then what it looks like in plain JS or in this repo,
> then which note explains it properly. Entries marked **(coming)** are from chapters you haven't reached yet; they're
> here so the word isn't a wall when you meet it.
>
> Grouped by course chapter, in the order you meet them. The A–Z list at the bottom points back into the groups.

---

## 0. JavaScript and classes (learned alongside chapter 1)

**class** — a recipe for making objects that all have the same shape and the same functions. *Plain JS:* a factory function that returns an object, with extras. → note 02

**instance / object** — one thing made from the recipe, living in memory. Two instances of the same class have separate data. *Plain JS:* the object your factory function returned. → note 02

**`new`** — the keyword that makes an empty object, links it to the class's functions, runs the constructor on it, and gives it back. `new` creates; the constructor only fills in. → note 02 §3

**constructor** — the function that runs once, right after `new` makes the object, to put starting values on it. Its parameter list is the object's "what I need to be built" list. → notes 02, 13

**field / property** — a named box on the object (`this.users`). It lives as long as the object does. *Plain JS:* a variable captured by a closure. → notes 02, 04

**method** — a function that belongs to the class. Stored once and shared by every instance; reaches the instance's data through `this`. → note 02 §3.4

**`this`** — "the object I was called on": whatever was before the dot. It's decided by *how* a function is called, not where it's written, which is why `const fn = obj.method; fn()` loses it. → note 02 §3.5

**prototype** — the shared place where a class's methods live. `obj.greet()` looks on `obj` first, then walks up to the class's prototype. Why methods aren't copied per object. → note 02 §3.4

**closure** — a function that remembers the variables around it even after the outer function returned. The functional way to keep state; classes use fields instead. → note 02 §5

**factory function** — a function that builds and returns an object (`makeCoffeeService(...)`). The functional twin of a class. → notes 02, 13

**parameter property** — TypeScript shorthand: `constructor(private readonly x: X) {}` means "declare a field `x` and set `this.x = x`". The empty `{}` isn't empty after compiling. → note 02 §3.6

**`private` / `readonly`** — compile-time promises: "only this class touches it" / "never reassigned". Gone at runtime; `console.log(obj)` still prints private fields. → note 02 §3.6

**`extends`** — "this class starts with everything that class has." Inheritance. Often the wrong tool when you could pass the thing in instead (composition). → notes 02, 07 (`PartialType`)

**`implements`** — "I promise to have the methods this interface lists." A TypeScript check only. → note 06 §5

**generic (`<T>`)** — a placeholder for a type, like a parameter but for types. `Repository<Coffee>` means "a repository whose rows are coffees". Erased when compiled, which is why Nest can't inject by it alone. → notes 06, 09, 13

**decorator (`@Something`)** — a function that runs once when the file loads and sticks a label on a class, method or parameter. It doesn't change behavior by itself; Nest reads the labels later. → note 03 §4

**metadata** — those labels: notes attached to a class that code can read at runtime (`Reflect.getMetadata`). `@Module`, `@Column`, `@IsString` all write metadata, each to its own list. → notes 03, 07 §6.1

**compile time vs runtime** — what TypeScript checks while you type vs what actually happens when the code runs. Types, `private`, `<T>` and interfaces exist only at compile time. Most validation bugs come from confusing the two. → notes 02, 07

---

## Chapters 1–2 · Nest basics and a REST API (videos 1–19)

**module** — a box that lists which controllers and services belong together, and which services it lends to other boxes. Its `providers` are private unless `exports` says otherwise. → notes 03, 13 §step 8

**controller** — the class whose methods are URL handlers. Reads the request, calls a service, returns the result. Knows HTTP; knows no business rules. → notes 01, 03

**provider / service** — any class Nest builds and hands to others. "Service" is the common kind: the business logic. → notes 03, 13

**dependency injection (DI)** — you list what a class needs in its constructor; Nest builds those things and passes them in. You never call `new` on your own services. → notes 03, 13

**singleton** — built once at startup, and the same object is handed to everyone. Nest's default for every provider. Why fields on a service are shared between all requests. → notes 03, 04

**route / endpoint** — one URL + method pair (`GET /coffee/:id`) and the handler that answers it. → note 03

**`@Param` / `@Query` / `@Body`** — "take this part of the request and pass it as this argument": the URL segment, the `?a=b` part, the JSON body. Everything from the URL arrives as **text**. → notes 03, 07, 10 §5b

**status code** — the number that tells machines how it went: 2xx worked, 4xx the client's fault, 5xx ours. The body is for humans; the code is for `fetch`, caches, monitoring and retries. → notes 05, (08)

**DTO (data transfer object)** — the class that describes what a client is allowed to send. The **request shape**, separate from the database shape. → note 07

**validation pipe** — the step that checks a request's input against the DTO's rules before the handler runs, and answers 400 if it fails. → note 07

**whitelist / forbidNonWhitelisted / transform** — ValidationPipe options: drop fields that have no rule / reject the request instead / turn the plain JSON into a real DTO instance and convert `"5"` to `5`. → note 07 §3.4

**mass assignment** — saving whatever the client sent (`...dto`) so they can set fields you never meant to expose (`isAdmin`). → note 07

**trust boundary** — the edge where outside data enters. Nothing across it is trusted until checked. Frontend validation is UX; backend validation is security. → note 07

**pipe** — a small function that runs on one argument before the handler: check it, or convert it (`"5"` → `5`). `ParseIntPipe`, `ValidationPipe`. Not the RxJS `.pipe`, not a stream pipe. → notes 06 §3.3a, 07

**exception / throw** — stop everything and hand an error up the call stack until something catches it. In Nest, throwing `NotFoundException` anywhere becomes a 404. → note 05

**exception filter** — Nest's one big `catch` around every request, deciding what error response the client gets. Error Boundaries for your API. → note 05

**interceptor** — code that wraps a handler: runs before it, and again after it with the result. Response envelopes, timing, timeouts, caching. Axios interceptors, server side. → note 06

**Observable** — "a value that arrives later", with operators to transform it. What `next.handle()` returns inside an interceptor. `.pipe(map(fn))` ≈ `.then(fn)`. → note 06 §3.3

**cross-cutting concern** — a job that applies to many routes but belongs to none of them (logging, wrapping, timing). What interceptors, filters and middleware are for. → note 06

**event loop** — the single thread that runs your JavaScript, one piece at a time, switching to another request whenever the current one `await`s. I/O doesn't block it; CPU work does. → note 04

**stateless** — the server keeps nothing about you between requests. Each request carries everything needed (a token, an id). What lets you run ten copies behind a load balancer. → note 04

**race condition** — two requests overlapping in a way that produces a wrong result, usually a read → `await` → write on shared state. Only shows up under load. → notes 04, 11 §4

**idempotent (coming, note 08)** — doing it twice has the same effect as doing it once. `PUT` and `DELETE` should be; `POST` usually isn't. Why retries need care. → notes 04 Q5, 11

**PUT vs PATCH (coming, note 08)** — replace the whole thing vs change some fields. Our update routes are really PATCH. → coffee.controller.ts comments

---

## Chapter 3 · Postgres, Docker, TypeORM (videos 20–32)

**Docker image** — a frozen bundle of a program plus the mini operating system it needs. A recipe. *Like:* a class. → note 09 A

**container** — one running copy of an image, isolated from the rest of your machine. *Like:* an instance. → note 09 A

**volume** — a folder Docker keeps outside the container so data survives when the container is deleted. Without a named one, `down` + `up` = empty database. → note 09 A §3.6

**port mapping (`5432:5432`)** — a door from your Mac's port into the container's port. Inside a container, `localhost` means the container itself. → note 09 A §3.7

**docker compose** — one YAML file describing the containers your project needs, and one command to run them all. → note 09 A

**ORM (object-relational mapper)** — a library that maps classes ↔ tables and objects ↔ rows, and writes the SQL for you. TypeORM here. → note 09 B

**entity** — a class that describes one table: the class is the table, each property is a column, each object is a row. `@Entity()`, `@Column()`. → note 09 B

**repository** — a helper object with ready-made functions for one table (`find`, `save`, `delete`). *Plain JS:* `{ find: () => db.query('SELECT …') }`. → note 09 B §2

**DataSource** — the open connection to the database (really a pool of connections), created once by `forRoot()`. What repositories and transactions use underneath. → notes 09 B, 11

**`forRoot()` / `forFeature()`** — "connect once, for the whole app" / "give this module the table helpers for these entities". A pair you'll see in many Nest modules. → note 09 B §3.1b

**`@InjectRepository(Coffee)`** — "hand me the coffee table helper". Needed because `Repository<Coffee>` loses its `<Coffee>` when compiled. → notes 09 B, 13 step 5

**connection pool** — a small set of open database connections (about 10) that requests borrow and return. Why slow queries hurt everyone, and why a forgotten `release()` hangs the app. → notes 09 B §3.6, 11

**`synchronize: true`** — at startup, change the database to match the entity classes. Local-only: it drops a renamed column *with its data*. → notes 09 B, 12 B

**relation** — a link between rows in different tables. → note 10

**one-to-many / many-to-many** — "one user has many orders" (a `userId` column on orders) / "a coffee has many flavors and a flavor has many coffees" (needs a third table). → note 10

**join table / link table** — the third table that only stores pairs of ids (`coffeeId, flavorId`), one row per connection. → note 10 §2

**foreign key** — "this number must match a real id in that other table", enforced by the database itself. → note 10 §2

**primary key** — the column (or pair) that uniquely identifies a row. Gets an index automatically. → notes 09, 12

**cascade** — when saving a coffee, also save the new flavor rows attached to it. Also: what happens to link rows when a coffee is deleted (`ON DELETE CASCADE`). → note 10

**N+1 queries** — fetch a list, then run one more query per item in a loop. Fine with 10 rows, fatal with 10,000. Fixed by asking for the relation up front. → note 10 §4

**pagination (offset / cursor)** — return a slice, not the table. Offset = "skip 20, give me 10" (simple, slow deep down). Cursor = "the 10 after id X" (fast at any depth). → note 10 §5b

**transaction** — "apply all of these statements, or none." `BEGIN … COMMIT`, or `ROLLBACK` to undo. Lives on one connection. → note 11

**ACID** — the four promises of a transaction in one word: all-or-nothing, rules still hold, nobody sees half a job, committed means kept. → note 11 §2

**query runner** — TypeORM's "give me one connection and let me keep it" object, needed because a transaction must stay on a single connection. → note 11 §3

**lost update** — two requests read 5, both write 6. A transaction does *not* prevent it; the database doing the arithmetic (`x = x + 1`) or a lock does. → notes 04, 11 §4

**index** — a sorted lookup structure for a column, so the database can jump to a value instead of reading every row. 14.6 ms → 0.045 ms on 500k rows in our container. Costs disk and write speed. → note 12 A

**seq scan / index scan** — what `EXPLAIN ANALYZE` prints: "I read the whole table" vs "I looked it up". → note 12 A

**migration** — a small, reviewed, committed file that changes the database shape in a controlled way, with an undo. Replaces `synchronize` for anything real. → note 12 B

---

## Chapter 4 · Dependency injection deep dive (videos 33–43)

**dependency** — an argument your constructor asks for. → note 13

**token** — the name on the left of a phone-book entry. Usually the class itself; a string when the thing isn't a class (`'COFFEE_BRANDS'`). → note 13 step 5

**container / IoC container** — the phone book of names → things, plus the code that builds them. "Inversion of control" = Nest calls your constructors, you don't. → note 13

**resolve** — look a name up, building the thing if it isn't built yet. → note 13 §4

**`@Inject(token)`** — "look this name up instead of my parameter's type." → note 13 step 5

**`useValue` / `useClass` / `useFactory`** — three ways to fill the right side of an entry: a ready-made thing / a class to `new` / a function to call (which may ask for other entries via `inject`). A constant, a constructor call, a function call. → note 13 steps 4, 6, 7

**encapsulation (module)** — each module's providers are private unless listed in `exports`. → notes 03, 13 step 8

**async provider (video 40, coming)** — a `useFactory` that returns a promise. Nest waits for it before starting, so "connect to the database first" is exactly this. → note 13 §4

**dynamic module (video 41, coming)** — a module built by a function at startup instead of written out by hand, so it can take options: `TypeOrmModule.forRoot({...})`, `ConfigModule.forRoot()`. You'll write your own. → note 14

**scope: singleton / request / transient (videos 42–43, coming)** — how often Nest builds a provider: once for the app (default) / once per incoming request / fresh for every injection. Request scope fixes the "per-request data on `this`" problem at a real cost: the whole object graph is rebuilt per request. → note 14, note 04

---

## Chapter 5 · Configuration (videos 44–50, coming)

**environment variable** — a named value the operating system hands to a process at start (`PORT=3000`). How the same code gets different settings per machine. `process.env.PORT`. → note 15

**`.env` file** — a text file of `KEY=value` lines loaded into `process.env` for local development. Never committed with real secrets. → note 15

**ConfigModule / ConfigService** — Nest's way to load `.env`, validate it, and hand values to services through DI instead of reading `process.env` everywhere. → note 15

**schema validation (Joi)** — check at startup that every required setting exists and has the right shape, and refuse to boot otherwise. Fail early, not on the first request. → note 15

**configuration namespace (`registerAs`)** — grouping settings under a name (`database.host`) so a module gets only its slice. → note 15

**`forRootAsync()`** — the async twin of `forRoot()`: configure a module using values that come from another provider (usually `ConfigService`). → notes 14, 15

**twelve-factor config** — the rule "config comes from the environment, not from code", so one build runs everywhere. → note 15

---

## Chapter 6 · The other building blocks (videos 51–60, coming)

**binding** — where you attach a filter/guard/interceptor/pipe: to one method, one controller, or globally (`APP_FILTER`, `APP_GUARD`, `APP_INTERCEPTOR`, `APP_PIPE` for global-with-DI). → notes 05, 06, 07, 16

**guard** — "may this request continue?" Runs before pipes and interceptors, answers yes/no, and stops the request with 401/403 on no. → note 16

**authentication vs authorization** — "who are you?" (401 if unknown) vs "are you allowed?" (403 if not). Two different questions, two different status codes. → notes 05, 16

**`canActivate` / ExecutionContext** — the guard's one method, and the object that tells it which request, handler and controller it's looking at. → notes 06 §3.4, 16

**metadata on routes (`SetMetadata`, `Reflector`)** — stick a label on a route (`@Public()`, `@Roles('admin')`) and read it inside a guard or interceptor to decide what to do. → note 16

**custom decorator** — your own `@Something`, usually built from `SetMetadata` or `createParamDecorator` (e.g. `@CurrentUser()` pulling the user off the request). → note 17

**middleware** — an Express-style `(req, res, next)` function that runs before everything Nest does. For generic plumbing: logging, CORS, cookies, body parsing. → notes 01, 17

**timeout interceptor** — give up waiting after N ms and answer 408. It stops *waiting*, not the work: the database query keeps running. → note 06

**custom pipe** — your own `transform(value)` for one argument: `ParsePositiveIntPipe`, and the like. → note 07 §3.1

---

## Chapter 7 · API docs (videos 61–65, coming)

**OpenAPI / Swagger** — a machine-readable description of every route, its inputs and outputs, generated from your controllers and DTOs, plus a web page to try them. The contract your frontend team codes against. → note 18

**`@ApiProperty` / CLI plugin** — how DTO fields show up in the docs; the plugin reads them automatically so you don't annotate everything by hand. → note 18

**tags** — grouping routes in the docs page by resource (coffees, users). → note 18

---

## Chapter 8 · Testing (videos 66–71, coming)

**unit test** — test one class alone, with its dependencies replaced by fakes, no database. Fast, precise. → note 19

**e2e (end-to-end) test** — start the real app, send real HTTP requests (supertest), check real responses, usually against a throwaway database. Slow, realistic. → note 19

**test double / mock / stub / fake** — a stand-in for a dependency. A `jest.fn()` you control; a plain object with the methods you need. DI is what makes swapping them in trivial. → notes 13, 19

**`Test.createTestingModule`** — build a small Nest module for a test, with real or fake providers, exactly like an app module. → note 19

**Jest: `describe` / `it` / `beforeEach` / `expect`** — group tests / one test / setup before each / the assertion. → note 19

**ESM mode (this repo)** — Nest 12 packages are ES modules; Jest needs `extensionsToTreatAsEsm` and specs need `import { jest } from '@jest/globals'`. → sessions/README.md

---

## Chapter 9 · MongoDB and Mongoose (videos 72–80, coming)

**NoSQL / document database** — stores JSON-like documents instead of rows in fixed tables. Flexible shape, different trade-offs (no joins the SQL way, no foreign keys). → note 20

**collection / document** — Mongo's table / row. → note 20

**Mongoose schema / model** — the class-like description of a document's shape, and the helper that reads and writes that collection (the Mongo twin of entity + repository). → note 20

**ObjectId** — Mongo's auto-generated id: a 24-character hex string, not an integer. → note 20

**SQL vs NoSQL** — the real lesson of the chapter: when a fixed schema and relations help you, and when a flexible document fits better. → note 20

---

# The next courses on the drive

These three come after the Fundamentals course. The words below are the ones their lesson titles use, so you can
look a title up before you press play. Nothing here is required for the Fundamentals course.

## Course 2 · Authentication and Authorization (20 videos)

**authentication** — "who are you?" Proving identity: an email and password, a token, a Google login. Failing it is **401**. → notes 05, 16

**authorization** — "are you allowed to do this?" Asked *after* we know who you are. Failing it is **403**. → notes 05, 16

**hashing (a password)** — turning a password into a one-way scramble before storing it, so a stolen database doesn't hand over anyone's password. You never "unhash"; you hash the attempt and compare. (bcrypt, argon2.) → course 2

**salt** — random bytes mixed into each password before hashing, so two people with the same password get different hashes, and precomputed attack tables are useless. bcrypt puts the salt inside the hash string.

**sign-up / sign-in routes** — "create an account" and "prove it's you, here's a token". The two endpoints everything else hangs off.

**JWT (JSON Web Token)** — a string with three dot-separated parts: who you are, what's claimed about you, and a signature made with a server secret. The server can check it without looking anything up, which is what makes it stateless. ⚠️ **Signed, not encrypted**: anyone can read the middle part, so never put secrets in it.

**claim** — one fact inside a token: `sub` (the user id), `email`, `role`, `exp` (expiry).

**access token** — the short-lived token sent with every request (`Authorization: Bearer …`). Short-lived on purpose: if it leaks, it stops working soon.

**refresh token** — a longer-lived token whose only job is to get a new access token, so the user isn't logged out every 15 minutes. Stored more carefully, and usually one-use.

**token invalidation** — the hard part of JWTs: a signed token stays valid until it expires, so "log out everywhere" or "ban this user now" needs a server-side list (a denylist, a token id per user in Redis). The trade-off you accept when you choose stateless tokens.

**bearer token** — "whoever bears this token is allowed in". No further proof, which is why leaking one is as bad as leaking a password.

**session (with Passport)** — the older alternative: the server keeps a session record, and the browser holds only a cookie with its id. Easy to revoke (delete the record), but the server now holds state. → note 04

**cookie vs Authorization header** — where the credential travels. Cookies are automatic (browsers attach them, which is why CSRF exists); headers are manual (which is why mobile apps and APIs prefer them).

**RBAC (role-based access control)** — permission by role: admin, editor, viewer. Simple, coarse.

**claims-based authorization** — permission by facts on the token rather than a single role (`canEditCoffees: true`).

**policy-based authorization** — permission by a rule object you can test: "may user U do action A on resource R?" Handles "only the owner may edit this" and scales past roles.

**API key** — a long random string identifying an *application* rather than a person. Used for server-to-server calls.

**OAuth / "Sign in with Google"** — logging in by proving identity to a third party you already trust, which then vouches for you. You never see the user's Google password.

**two-factor authentication (2FA/TOTP)** — a second proof besides the password, usually a 6-digit code an app generates from a shared secret and the current time.

**`@Public()` / active-user decorator** — the practical pattern: a global guard protects everything, a label marks the few open routes, and a small custom decorator pulls the logged-in user off the request so handlers read `@ActiveUser() user` instead of digging into `req`. → notes 16, 17

## Course 3 · Architecture & Advanced Patterns (21 videos)

**layered (N-tier) architecture** — what you already build: controller → service → repository, each layer only talking to the one below. → note 01

**three-tier** — the same idea named by deployment: presentation, business logic, data.

**hexagonal architecture (ports and adapters)** — turn the layers inside out: your business code defines *ports* (plain interfaces like "somewhere to save coffees") and knows nothing about Nest, HTTP or TypeORM. *Adapters* on the outside plug the real world into those ports. Swap Postgres for Mongo, or HTTP for a queue, without touching business code.

**port / adapter** — the interface the business code owns / the implementation that satisfies it (`TypeOrmCoffeeRepository`, `HttpCoffeeController`).

**onion architecture** — the same "dependencies point inward" rule drawn as rings, with the domain at the centre.

**DDD (domain-driven design)** — build the code around the language the business actually uses, so a domain expert could read your class names and recognise their work.

**ubiquitous language** — one shared vocabulary for code, tests and conversations. If the business says "recommendation", the class isn't called `CoffeeVote`.

**entity (DDD sense)** — a thing with an identity that persists through change (a coffee, a user). ⚠️ Different from a TypeORM `@Entity`, which is a table mapping; DDD's entity is a business object that ideally doesn't know about tables at all. → note 09

**value object** — a thing defined entirely by its values, with no identity: money, an email address, a date range. Two are equal when their contents are equal, and they're immutable.

**aggregate / aggregate root** — a cluster of objects saved and loaded as one unit, with one object as the door in. "An order and its lines" is an aggregate; you never edit a line without going through the order. Keeps rules enforceable.

**domain event** — a past-tense fact the business cares about: `CoffeeRecommended`, `OrderPaid`. Other parts of the system react to it. (The `event` table in Fundamentals video 30 is a first taste.) → note 11

**bounded context** — a boundary inside which one model and one vocabulary apply. "Customer" in billing and "customer" in support are different models; pretending they're one is how a class ends up with forty fields.

**CQRS (command query responsibility segregation)** — separate the write path from the read path. Commands change state and return nothing; queries read and change nothing. Each side can then be shaped and scaled for its own job.

**command / query / handler** — an intention to change something (`RecommendCoffeeCommand`) / a request for data (`GetCoffeesQuery`) / the class that executes one of them.

**read model (projection)** — a shape built purely for reading, often denormalised so a screen is one fast query. Updated from events.

**event-driven architecture** — parts communicate by publishing facts rather than calling each other. The publisher doesn't know who listens, so new behavior can be added without editing it.

**eventual consistency** — after a write, the read side catches up in a moment rather than instantly. The price of splitting reads from writes, and something the product has to accept ("your review will appear shortly").

**event sourcing** — store the *events* as the source of truth instead of the current state. The current state is what you get by replaying them. You gain a complete history and the ability to ask new questions about the past.

**event store** — the append-only log those events live in.

**rehydrating an aggregate** — rebuilding an object's current state by replaying its events from the store.

**snapshot** — a saved state at event #N, so replaying doesn't have to start from zero every time.

**saga (process manager)** — coordinates a multi-step process across parts that each have their own transaction, by listening for events and issuing the next command, including the compensating steps when something fails half-way ("refund the payment, we couldn't ship").

**compensating action** — the undo you write yourself, because a database `ROLLBACK` can't reach across services or un-charge a card. → note 11

## Course 4 · Advanced Concepts (18 videos)

**explicit vs implicit dependencies** — asking for something in the constructor (visible, swappable, testable) versus reaching for it inside the method (`new`, a global, a singleton import). Implicit ones are why a class is hard to test. → note 13

**lazy-loading modules** — don't build a module at startup; build it the first time it's needed. Cuts cold-start time in serverless, where every millisecond of boot is paid on every cold request.

**`ModuleRef` (accessing the container)** — asking the container for something at runtime, by name, instead of through the constructor. The escape hatch for "which implementation depends on this request", and easy to overuse. → note 13

**worker threads** — real extra threads for CPU-heavy work, so a slow calculation doesn't freeze the single thread that serves everyone. The proper answer to note 04's "CPU work blocks everybody". → note 04

**circuit breaker** — stop calling a service that keeps failing, answer fast with a fallback, and try again after a cooling-off period. Prevents one sick dependency from dragging down everything that waits on it.

**configurable module (`ConfigurableModuleBuilder`)** — the tooling for writing your own `forRoot()` / `forRootAsync()`, so your module takes options like `TypeOrmModule` does. → note 14

**mixin** — a function that takes a class and returns an extended class, to share behavior without deep inheritance. Composition for classes. → note 02

**schematic** — the code generator behind `nest g service …`. Custom ones let a team scaffold its own conventions in one command.

**DI sub-tree** — a branch of the container with its own instances, used when part of the app needs its own copies of providers rather than the shared ones. → note 13

**durable provider** — a request-scoped provider that is cached per "tenant" instead of rebuilt per request, so multi-tenancy doesn't pay the request-scope cost on every call. → note 14

**multi-tenancy** — one running app serving many customers (tenants) with their data kept apart, by database, by schema, or by a tenant id column. The decision drives most of the architecture around it.

**i18n (internationalization)** — serving the right language and formats per request, a natural fit for the same per-tenant/per-request provider machinery.

---

## Beyond the course (touched in senior-lens sections)

**outbox pattern** — write "what happened" as a row in the same transaction, and let a separate worker act on it later. How "save + send email" becomes safe. → note 11 §6

**idempotency key** — a unique id the client sends with a request so a retry doesn't do the thing twice. → notes 04 Q5, 11 §6

**optimistic locking** — a version column; if the row changed under you, redo the work. → note 11 §4

**expand-and-contract** — change a schema in safe steps (add new column → write both → backfill → switch reads → drop old), because old and new code run at the same time during a deploy. → note 12 B §5

**cache invalidation** — the hard part of caching: knowing when a stored answer is no longer true. → note 06 Q3

**horizontal scaling** — more copies of the app behind a load balancer, which only works when the app is stateless. → note 04 §6

---

## A–Z quick lookup

access token · ACID · adapter · aggregate · API key · async provider · authentication · authentication vs authorization · authorization · bearer token · binding · bounded context · cache invalidation · `canActivate` · cascade · circuit breaker · claim · claims-based authorization · class · closure · collection · command · compensating action · compile time vs runtime · ConfigModule · configurable module · connection pool · constructor · container (Docker) · container (IoC) · controller · CQRS · cross-cutting concern · custom decorator · custom pipe · DataSource · DDD · decorator · dependency · dependency injection · DI sub-tree · docker compose · Docker image · document · domain event · DTO · durable provider · dynamic module · e2e test · encapsulation · entity · `.env` · environment variable · event loop · event sourcing · event store · event-driven architecture · eventual consistency · exception · exception filter · expand-and-contract · explicit vs implicit dependencies · `extends` · factory function · field · foreign key · `forRoot` / `forFeature` · `forRootAsync` · generic · guard · hashing · hexagonal architecture · horizontal scaling · i18n · idempotency key · idempotent · `implements` · index · `@Inject` · `@InjectRepository` · instance · interceptor · Jest · join table · JWT · layered architecture · lazy-loading modules · lost update · many-to-many · mass assignment · metadata · method · middleware · migration · mixin · mock · module · ModuleRef · Mongoose model · multi-tenancy · N+1 · `new` · NoSQL · OAuth · ObjectId · Observable · one-to-many · onion architecture · OpenAPI · optimistic locking · ORM · outbox · pagination · parameter property · pipe · policy-based authorization · port · port mapping · primary key · `private` / `readonly` · prototype · provider · PUT vs PATCH · query runner · race condition · RBAC · read model · refresh token · `registerAs` · rehydrating · relation · repository · resolve · route · saga · salt · schema validation · schematic · scope · seq scan · session · singleton · snapshot · stateless · status code · `synchronize` · `Test.createTestingModule` · `this` · timeout interceptor · token · token invalidation · transaction · trust boundary · twelve-factor · two-factor authentication · ubiquitous language · unit test · `useValue` / `useClass` / `useFactory` · validation pipe · value object · volume · whitelist · worker threads
