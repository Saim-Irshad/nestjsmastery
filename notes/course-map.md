# Official Course Map: NestJS Fundamentals (2025)

> Local files: `/Volumes/SaimWorkSpace/SaimWorkspace/courses/nestJS/1. Learn NestJS - NestJS Fundamentals 2025-5/`
> The **Video** column is the real `lessonN.mp4` file number. Titles are the official ones, taken from the lesson
> pages inside `code.zip`.

**Three different numbering systems are in play here, which is why this table used to be wrong:**

- There are **85 lesson pages** in `code.zip`. Five of them are text-only and have no video at all:
  page 1 (Course Disclaimer), page 6 (What we'll be building), page 7 (Beginning your NestJS Journey),
  page 26 (How to visualize your Postgres Database) and page 85 (Congratulations).
- That leaves **80 videos**, `lesson1.mp4` … `lesson80.mp4`. This is the numbering the table below uses.
- There are only **76 subtitle files**, because videos 2, 4, 11 and 73 were never captioned. Whoever packaged
  the course numbered the `.srt` files 1–76 consecutively anyway, closing the gaps — so every subtitle after
  video 1 was named after the wrong video. That's now fixed on disk (renamed 2026-09-22), and the earlier
  version of this table had inherited the same off-by-N drift.

> Notes are organised by **concept**, not by lesson. Several lessons feed one note, and older notes get extended when the course goes deeper.
>
> Course project: **"ILuvCoffee" API** (coffees + flavors). Build it inside this repo, e.g. `src/coffees/`.

Legend: ✅ covered in notes · 🔄 extends an existing note · ⬜ upcoming · 🔇 video has no subtitle file

## Ch.1–2 — Basics & REST API (videos 1–19)

| Video | Lesson | Note | |
|---|---|---|---|
| 1–6 | Intro, installing the CLI 🔇, generating the app, what's inside it 🔇, Insomnia, dev mode | [01](01-express-vs-nest-architecture.md) | ✅ |
| 7 | Creating a Basic Controller | [03](03-modules-controllers-providers-di.md) | ✅ |
| 8 | Use Route Parameters | [03](03-modules-controllers-providers-di.md) | ✅ |
| 9 | Handling Request Body / Payload | [03](03-modules-controllers-providers-di.md) | ✅ |
| 10 | Response Status Codes | 08 REST & HTTP | ⬜ |
| 11 | Handling Update and Delete Requests 🔇 | 08 REST & HTTP | ⬜ |
| 12 | Implement Pagination with Query Parameters | 08 REST & HTTP | ⬜ |
| 13 | Creating a Basic Service | [03](03-modules-controllers-providers-di.md) | ✅ |
| 14 | Send User-Friendly Error Messages | [05](05-exception-filters.md) | ✅ |
| 16 | Encompass Business-Domain in Modules | [03](03-modules-controllers-providers-di.md) | ✅ |
| 16 | Introduction to Data Transfer Objects | [07](07-pipes-validation.md) | ✅ |
| 17 | Validate Input Data with DTOs | [07](07-pipes-validation.md) | ✅ |
| 18 | Handling Malicious Request Data | [07](07-pipes-validation.md) | ✅ |
| 19 | Auto-transform Payloads to DTO instances | [07](07-pipes-validation.md) | ✅ |

## Ch.3 — PostgreSQL + TypeORM (videos 20–32)

| Video | Lesson | Note | |
|---|---|---|---|
| 20–22 | Before we Get Started, Install Docker, Running PostgreSQL | [09](09-database-docker-typeorm.md) Part A | ✅ |
| — | *How to visualize your Postgres Database (GUI) — text-only page, no video* | | |
| 23 | Introducing the TypeORM Module | [09](09-database-docker-typeorm.md) Part B | ✅ |
| 24 | Creating a TypeORM Entity | [09](09-database-docker-typeorm.md) Part B | ✅ |
| 25 | Using Repository to Access Database | [09](09-database-docker-typeorm.md) Part B | ✅ |
| 26 | Create a Relation between two Entities | [10](10-relations.md) | ✅ |
| 27 | Retrieve Entities with their Relations | [10](10-relations.md) | ✅ |
| 28 | Using Cascading Inserts and Updates | [10](10-relations.md) | ✅ |
| 29 | Adding Pagination | 10 (next) | ⬜ |
| 30 | Use Transactions | [11](11-transactions.md) | ✅ note (code: practice) |
| 31 | Adding Indexes to Entities | [12](12-indexes-migrations.md) | ✅ |
| 32 | Setting up Migrations | [12](12-indexes-migrations.md) | ✅ |

## Ch.4 — Dependency Injection deep dive (videos 33–43)

| Video | Lesson | Note | |
|---|---|---|---|
| 33 | Understand Dependency Injection | [13](13-custom-providers.md) + [03](03-modules-controllers-providers-di.md) | ✅ |
| 34 | Control NestJS Module Encapsulation | [13](13-custom-providers.md) + [03](03-modules-controllers-providers-di.md) | ✅ |
| 35–40 | Custom providers: intro, `useValue`, non-class tokens, `useClass`, `useFactory`, async providers | [13](13-custom-providers.md) | ✅ |
| 41 | Create a Dynamic Module | [14](14-dynamic-modules.md) | ✅ |
| 42–43 | Control Providers Scope, request-scoped providers | [14](14-dynamic-modules.md) Part B + 🔄 [04](04-requests-shared-state-event-loop.md) | ✅ |

## Ch.5 — Configuration (videos 44–50)

| Video | Lesson | Note | |
|---|---|---|---|
| 44–49 | ConfigModule, custom env file paths, schema validation, ConfigService, custom config files, namespaces | [15](15-configuration.md) | ✅ |
| 50 | Asynchronously Configure Dynamic Modules | [15](15-configuration.md) §3 step 8 | ✅ |

## Ch.6 — Other building blocks (videos 51–60)

| Video | Lesson | Note | |
|---|---|---|---|
| 51–52 | Introducing More Building Blocks, Understanding Binding Techniques | 16 Guards & Metadata (+ Big Map) | ⬜ |
| 53 | Catch Exceptions with Filters | 🔄 [05](05-exception-filters.md) | ⬜ |
| 54 | Protect Routes with Guards | 16 | ⬜ |
| 55 | Using Metadata to Build Generic Guards or Interceptors | 16 + 🔄 [06](06-interceptors.md) | ⬜ |
| 56 | Add Pointcuts with Interceptors | 🔄 [06](06-interceptors.md) | ⬜ |
| 57 | Handling Timeouts with Interceptors | 🔄 [06](06-interceptors.md) | ⬜ |
| 58 | Creating Custom Pipes | 🔄 [07](07-pipes-validation.md) | ⬜ |
| 59 | Bonus: Add Request Logging with Middleware | 17 Middleware & Custom Decorators | ⬜ |
| 60 | Bonus: Create Custom Param Decorators | 17 | ⬜ |

## Ch.7 — OpenAPI / Swagger (videos 61–65)

| Video | Lesson | Note | |
|---|---|---|---|
| 61–65 | Swagger module, CLI plugin, decorating model properties, example responses, tags | 18 API Docs (OpenAPI) | ⬜ |

## Ch.8 — Testing (videos 66–71)

| Video | Lesson | Note | |
|---|---|---|---|
| 66–68 | Introduction to Jest, test suites, unit tests | 19 Testing | ⬜ |
| 69–71 | Diving into e2e tests, first e2e test, e2e test logic | 19 | ⬜ |

## Ch.9 — MongoDB + Mongoose (videos 72–80)

| Video | Lesson | Note | |
|---|---|---|---|
| 72–77 | Before we Get Started, Install Docker 🔇, Running MongoDB, Mongoose module, Mongoose model, using the model | 20 MongoDB & SQL vs NoSQL | ⬜ |
| 78–80 | Adding Pagination, Use Transactions, Adding Indexes to Schemas (Mongo versions) | 19 | ⬜ |

---

## Next courses on the drive

Lesson lists taken from the drive, so you can plan without digging. Glossary entries for every word in these
titles are in [glossary.md](glossary.md), under "The next courses on the drive".

### Course 2 · Authentication and Authorization (20 videos) — roadmap days 16–17

Files are `lesson1.mp4` … `lesson20.mp4` (no subtitles). Titles from `NestJS Authentication and Authorization.txt`:

| # | Lesson | Planned note |
|---|---|---|
| 1–2 | Course overview · Authentication and Authorization | 21 Auth |
| 3–4 | Creating a Users resource · Insomnia | (revision of notes 03, 07, 09) |
| 5 | Hashing Passwords | 21 |
| 6 | Implementing Sign-in and Sign-up Routes | 21 |
| 7 | What's JWT? | 21 |
| 8–9 | Protecting our routes with a Guard · Adding Public Routes | 16 Guards + 21 |
| 10 | Active User Decorator | 17 Custom decorators |
| 11–12 | Implementing Refresh Tokens · Invalidating Tokens? | 21 |
| 13–15 | Role-Based · Claims-based · Policy-based Authorization | 22 Authorization |
| 16–17 | Introduction to API Keys · Integrate API Keys feature | 22 |
| 18 | Google Authentication (Nest portion) | 22 |
| 19–20 | Bonus: Two-factor authentication · Sessions with Passport | 22 |

### Course 3 · Architecture & Advanced Patterns (21 videos)

Titles are in the filenames. This is the "how do I structure a real system" course, and the natural follow-on
from notes 01 and 13.

| # | Lesson | Theme |
|---|---|---|
| 01–02 | Intro · Generate a Nest application | setup |
| 03–04 | Layered (N-tier) Architecture · Three-tier vs Hexagonal | how code is arranged |
| 05–07 | Hexagonal in Practice 1 & 2 · Onion Architecture | ports and adapters |
| 08 | Introduction to Domain-Driven Design | modelling the business |
| 09–10, 12, 14 | CQRS · Experimenting with CQRS 1–3 | splitting reads from writes |
| 11, 13 | Event-Driven Architecture · Eventual Consistency | talking through events |
| 15–17 | Event Sourcing · Adding an Event Store 1 & 2 | events as the source of truth |
| 18–20 | Autowire Event classes · Rehydrating Aggregates · Snapshots | making event sourcing practical |
| 21 | Understanding Sagas | multi-step processes that can fail |

### Course 4 · Advanced Concepts (18 videos)

| # | Lesson | Theme |
|---|---|---|
| 1–3 | Overview · Generate an app · Debugging Common Errors | setup |
| 4 | Explicit vs Implicit Dependencies | extends note 13 |
| 5–6 | Lazy-loading Modules · Accessing the IoC container | extends notes 13, 14 |
| 7 | Worker Threads in Action | extends note 04 (CPU work blocks everyone) |
| 8 | Circuit Breaker pattern | resilience |
| 9 | Building Configurable Modules | extends note 14 (`forRoot` of your own) |
| 10 | Composition with Mixins | extends note 02 |
| 11–12 | Schematics · Custom Schematics | your own `nest g` |
| 13–14 | DI sub-trees · practical example | extends note 13 |
| 15–18 | Durable Providers · Multi-tenancy · Durable Providers for multi-tenancy and i18n | one app, many customers |

### GraphQL courses (code-first, schema-first)

Optional. Same Nest ideas (modules, DI, guards) with GraphQL instead of REST as the door in.

### Suggested order after Fundamentals

1. **Course 2 (Auth)** — it finishes the app you can actually ship, and it makes notes 16–17 real.
2. **Course 4, videos 4–9** — the pieces that deepen what you already know (dependencies, lazy loading, worker threads, circuit breaker, configurable modules).
3. **Course 3** — architecture and CQRS/event sourcing. Most valuable *after* you've felt the pain these patterns solve; before that it reads like ceremony.
4. The rest of course 4, then GraphQL if you need it.
