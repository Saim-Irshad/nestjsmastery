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
| 15 | Encompass Business-Domain in Modules | [03](03-modules-controllers-providers-di.md) | ✅ |
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
| 30 | Use Transactions | 11 Transactions, Indexes & Migrations | ⬜ |
| 31 | Adding Indexes to Entities | 11 | ⬜ |
| 32 | Setting up Migrations | 11 | ⬜ |

## Ch.4 — Dependency Injection deep dive (videos 33–43)

| Video | Lesson | Note | |
|---|---|---|---|
| 33 | Understand Dependency Injection | 🔄 [03](03-modules-controllers-providers-di.md) | ⬜ |
| 34 | Control NestJS Module Encapsulation | 🔄 [03](03-modules-controllers-providers-di.md) | ⬜ |
| 35–40 | Custom providers: intro, `useValue`, non-class tokens, `useClass`, `useFactory`, async providers | 12 Custom Providers | ⬜ |
| 41 | Create a Dynamic Module | 13 Dynamic Modules & Scopes | ⬜ |
| 42–43 | Control Providers Scope, request-scoped providers | 13 + 🔄 [04](04-requests-shared-state-event-loop.md) | ⬜ |

## Ch.5 — Configuration (videos 44–50)

| Video | Lesson | Note | |
|---|---|---|---|
| 44–49 | ConfigModule, custom env file paths, schema validation, ConfigService, custom config files, namespaces | 14 Configuration & Secrets | ⬜ |
| 50 | Asynchronously Configure Dynamic Modules | 13 / 14 | ⬜ |

## Ch.6 — Other building blocks (videos 51–60)

| Video | Lesson | Note | |
|---|---|---|---|
| 51–52 | Introducing More Building Blocks, Understanding Binding Techniques | 15 Guards & Metadata (+ Big Map) | ⬜ |
| 53 | Catch Exceptions with Filters | 🔄 [05](05-exception-filters.md) | ⬜ |
| 54 | Protect Routes with Guards | 15 | ⬜ |
| 55 | Using Metadata to Build Generic Guards or Interceptors | 15 + 🔄 [06](06-interceptors.md) | ⬜ |
| 56 | Add Pointcuts with Interceptors | 🔄 [06](06-interceptors.md) | ⬜ |
| 57 | Handling Timeouts with Interceptors | 🔄 [06](06-interceptors.md) | ⬜ |
| 58 | Creating Custom Pipes | 🔄 [07](07-pipes-validation.md) | ⬜ |
| 59 | Bonus: Add Request Logging with Middleware | 16 Middleware & Custom Decorators | ⬜ |
| 60 | Bonus: Create Custom Param Decorators | 16 | ⬜ |

## Ch.7 — OpenAPI / Swagger (videos 61–65)

| Video | Lesson | Note | |
|---|---|---|---|
| 61–65 | Swagger module, CLI plugin, decorating model properties, example responses, tags | 17 API Docs (OpenAPI) | ⬜ |

## Ch.8 — Testing (videos 66–71)

| Video | Lesson | Note | |
|---|---|---|---|
| 66–68 | Introduction to Jest, test suites, unit tests | 18 Testing | ⬜ |
| 69–71 | Diving into e2e tests, first e2e test, e2e test logic | 18 | ⬜ |

## Ch.9 — MongoDB + Mongoose (videos 72–80)

| Video | Lesson | Note | |
|---|---|---|---|
| 72–77 | Before we Get Started, Install Docker 🔇, Running MongoDB, Mongoose module, Mongoose model, using the model | 19 MongoDB & SQL vs NoSQL | ⬜ |
| 78–80 | Adding Pagination, Use Transactions, Adding Indexes to Schemas (Mongo versions) | 19 | ⬜ |

---

## Next courses on the drive (after Fundamentals)

1. `2. Learn NestJS - NestJS Authentication and Authorization` → Days 16–17
2. `3. ... Architecture & Advanced Patterns` and `4. ... Advanced Concepts` → pick topics for Day 18 (system design) and after the 20 days
3. GraphQL courses → optional, later
