# Official Course Map: NestJS Fundamentals (2025)

> Local files: `/Volumes/SaimWorkSpace/SaimWorkspace/courses/nestJS/1. Learn NestJS - NestJS Fundamentals 2025-5/`
> Numbers below = **video file numbers** (`lessonN.mp4` / `lessonN.srt`). Titles come from the lesson pages in `code.zip`
> (those pages are numbered differently because some are text-only, e.g. "Install Docker").
>
> Notes are organised by **concept**, not by lesson. Several lessons feed one note, and older notes get extended when the course goes deeper.
>
> Course project: **"ILuvCoffee" API** (coffees + flavors). Build it inside this repo, e.g. `src/coffees/`.

Legend: ✅ covered in notes · 🔄 extends an existing note · ⬜ upcoming

## Ch.1–2 — Basics & REST API (lessons 1–16)

| Video | Lesson | Note | |
|---|---|---|---|
| 1–4 | CLI, generating an app, Insomnia, dev mode | [01](01-express-vs-nest-architecture.md) | ✅ |
| 5 | Creating a Basic Controller | [03](03-modules-controllers-providers-di.md) | ✅ |
| 6 | Route Parameters | [03](03-modules-controllers-providers-di.md) | ✅ |
| 7 | Request Body / Payload | [03](03-modules-controllers-providers-di.md) | ✅ |
| 8 | Response Status Codes | 08 REST & HTTP | ⬜ |
| 9 | Pagination with Query Parameters | 08 REST & HTTP | ⬜ |
| 10 | Creating a Basic Service | [03](03-modules-controllers-providers-di.md) | ✅ |
| 11 | User-Friendly Error Messages | [05](05-exception-filters.md) | ✅ |
| 12 | Encompass Business-Domain in Modules | [03](03-modules-controllers-providers-di.md) | ✅ |
| 13 | Intro to DTOs | [07](07-pipes-validation.md) | ✅ |
| 14 | Validate Input with DTOs | [07](07-pipes-validation.md) | ✅ |
| 15 | Handling Malicious Request Data (whitelist) | [07](07-pipes-validation.md) | ✅ |
| 16 | Auto-transform Payloads to DTO instances | [07](07-pipes-validation.md) | ✅ |

## Ch.3 — PostgreSQL + TypeORM (lessons 17–29)

| Video | Lesson | Note | |
|---|---|---|---|
| 17–19 | Before we start, Docker, running PostgreSQL | [09](09-database-docker-typeorm.md) Part A | ✅ |
| 20 | TypeORM Module | [09](09-database-docker-typeorm.md) Part B | ✅ |
| 21 | Creating an Entity | [09](09-database-docker-typeorm.md) Part B | ✅ |
| 22 | Using a Repository | [09](09-database-docker-typeorm.md) Part B | ✅ |
| 23 | Relations between Entities | 10 Relations & Pagination | ⬜ |
| 24 | Retrieving Entities with Relations | 10 | ⬜ |
| 25 | Cascading Inserts and Updates | 10 | ⬜ |
| 26 | Adding Pagination | 10 | ⬜ |
| 27 | Transactions | 11 Transactions, Indexes & Migrations | ⬜ |
| 28 | Indexes | 11 | ⬜ |
| 29 | Migrations | 11 | ⬜ |

## Ch.4 — Dependency Injection deep dive (lessons 30–40)

| Video | Lesson | Note | |
|---|---|---|---|
| 30 | Understand Dependency Injection | 🔄 [03](03-modules-controllers-providers-di.md) | ⬜ |
| 31 | Module Encapsulation | 🔄 [03](03-modules-controllers-providers-di.md) | ⬜ |
| 32–37 | Custom providers: `useValue`, string/symbol tokens, `useClass`, `useFactory`, async providers | 12 Custom Providers | ⬜ |
| 38 | Dynamic Modules | 13 Dynamic Modules & Scopes | ⬜ |
| 39–40 | Provider scopes, request-scoped providers | 13 + 🔄 [04](04-requests-shared-state-event-loop.md) | ⬜ |

## Ch.5 — Configuration (lessons 41–47)

| Video | Lesson | Note | |
|---|---|---|---|
| 41–46 | ConfigModule, env file paths, schema validation, ConfigService, custom config files, namespaces | 14 Configuration & Secrets | ⬜ |
| 47 | Async configuration of dynamic modules | 13 / 14 | ⬜ |

## Ch.6 — Other building blocks (lessons 48–57)

| Video | Lesson | Note | |
|---|---|---|---|
| 48–49 | Building blocks overview, binding techniques (global / controller / method / param) | 15 Guards & Metadata (+ Big Map) | ⬜ |
| 50 | Exception Filters | 🔄 [05](05-exception-filters.md) | ⬜ |
| 51 | Guards | 15 | ⬜ |
| 52 | Metadata for generic guards/interceptors (`SetMetadata`, `Reflector`) | 15 + 🔄 [06](06-interceptors.md) | ⬜ |
| 53 | Interceptors | 🔄 [06](06-interceptors.md) | ⬜ |
| 54 | Timeouts with Interceptors | 🔄 [06](06-interceptors.md) | ⬜ |
| 55 | Custom Pipes | 🔄 [07](07-pipes-validation.md) | ⬜ |
| 56 | Request Logging with Middleware | 16 Middleware & Custom Decorators | ⬜ |
| 57 | Custom Param Decorators | 16 | ⬜ |

## Ch.7 — OpenAPI / Swagger (lessons 58–62)

| Video | Lesson | Note | |
|---|---|---|---|
| 58–62 | Swagger module, CLI plugin, model properties, example responses, tags | 17 API Docs (OpenAPI) | ⬜ |

## Ch.8 — Testing (lessons 63–68)

| Video | Lesson | Note | |
|---|---|---|---|
| 63–65 | Jest, test suites, unit tests | 18 Testing | ⬜ |
| 66–68 | e2e tests | 18 | ⬜ |

## Ch.9 — MongoDB + Mongoose (lessons 69–76+)

| Video | Lesson | Note | |
|---|---|---|---|
| 69–73 | Docker + MongoDB, Mongoose module, models | 19 MongoDB & SQL vs NoSQL | ⬜ |
| 74–76 | Pagination, transactions, indexes (Mongo versions) | 19 | ⬜ |

---

## Next courses on the drive (after Fundamentals)

1. `2. Learn NestJS - NestJS Authentication and Authorization` → Days 16–17
2. `3. ... Architecture & Advanced Patterns` and `4. ... Advanced Concepts` → pick topics for Day 18 (system design) and after the 20 days
3. GraphQL courses → optional, later
