# NestJS → Senior Backend Engineer: My Notes

> Frontend dev learning backend. I know functional JS, APIs, HTTP, what a DB and tokens are.
> Goal: understand **how things work behind the scenes, why they exist, and how NOT to do them**,
> and think like a senior backend engineer, not just "know Nest".

- Started with: https://www.youtube.com/watch?v=Q6NpiIp-6WM (up to Pipes)
- Now following: official NestJS Fundamentals course → [course-map.md](course-map.md)
- Plan: [00-roadmap.md](00-roadmap.md) (20 days, started 2026-09-15)

---

## 📚 Index

| # | Topic | Covers (beyond Nest) | Status |
|---|---|---|---|
| 00 | [Roadmap](00-roadmap.md) | the 20-day plan | 📌 |
| 01 | [Express vs Nest & Architecture](01-express-vs-nest-architecture.md) | how Express works inside, feature folders | ✅ |
| 02 | [JS Classes, Objects & `this`](02-js-classes-objects-this.md) | memory, references, `new`, prototype, TS modifiers | ✅ |
| 03 | [Modules, Controllers, Providers & DI](03-modules-controllers-providers-di.md) | decorators, DI container, singletons | ✅ |
| 04 | [Requests, Shared State & the Event Loop](04-requests-shared-state-event-loop.md) | concurrency, stateless HTTP, scaling | ✅ |
| 05 | [Exception Filters](05-exception-filters.md) | status codes, error contracts, crashes | ✅ |
| 06 | [Interceptors](06-interceptors.md) | RxJS just enough, response envelopes, timeouts, caching leaks | ✅ |
| 07 | [Pipes & Validation](07-pipes-validation.md) | trust boundary, mass assignment, runtime vs compile-time types | ✅ |
| 08 | REST & HTTP (course 1–12) | status codes, PUT vs PATCH, idempotency, pagination | ⬜ |
| 09 | [Database, Docker & TypeORM](09-database-docker-typeorm.md) | containers vs VMs, images/layers, volumes · ORMs, repositories, real SQL, pools | ✅ |
| 10 | [Relations](10-relations.md) | join tables, foreign keys, N+1, Promise.all vs await-in-loop | ✅ |
| 11 | [Transactions](11-transactions.md) | all-or-nothing, pools, lost updates, outbox | ✅ |
| 12 | [Indexes & Migrations](12-indexes-migrations.md) | how indexes work (measured), schema changes without data loss | ✅ |
| 13 | Custom Providers | depending on abstractions | ⬜ |
| 14 | Dynamic Modules & Scopes | cost of request scope | ⬜ |
| 15 | Configuration & Secrets | 12-factor config, fail fast | ⬜ |
| 16 | Guards & Metadata | authentication vs authorization | ⬜ |
| 17 | Middleware & Custom Decorators | Express middleware vs Nest layers | ⬜ |
| 18 | API Docs (OpenAPI) | API contracts | ⬜ |
| 19 | Testing | unit vs e2e, test doubles | ⬜ |
| 20 | MongoDB & SQL vs NoSQL | data modeling trade-offs | ⬜ |

Which course lesson feeds which note: [course-map.md](course-map.md).

Extras:
- [mistakes-and-aha.md](mistakes-and-aha.md): quiz answers I got wrong, "aha" moments, corrections
- [sessions/](sessions/): one file per session — what I built, what broke, what is still open
- [_template.md](_template.md): the shape every topic note follows

---

## 🗺️ THE BIG MAP: where every Nest concept sits in a request

Every topic note points back to this. When learning something new, first ask: **where on this map is it?**

```
                          ┌──────────────── SERVER START (once) ────────────────┐
                          │ main.ts → NestFactory.create(AppModule)             │
                          │ reads modules → `new`s every provider/controller    │
                          │ (one shared object each) → registers routes         │
                          └──────────────────────────────────────────────────────┘

 CLIENT (browser / app)
   │  HTTP request: method + URL + headers (token) + body
   ▼
 ┌──────────────┐
 │ Node / Express│  raw request arrives, new req/res objects made FOR THIS REQUEST
 └──────┬───────┘
        ▼
 ┌──────────────┐   Middleware   (16) "generic stuff for many routes": cookies, CORS, logging
 └──────┬───────┘
        ▼
 ┌──────────────┐   Guards       (15) "are you ALLOWED in?" → no: 401/403, stop here
 └──────┬───────┘
        ▼
 ┌──────────────┐   Interceptors (06) BEFORE part: start timer, etc.
 └──────┬───────┘
        ▼
 ┌──────────────┐   Pipes        (07) "is the input valid? convert it" ("5" → 5)
 └──────┬───────┘
        ▼
 ┌──────────────┐   Controller   (03) HTTP adapter: read params/body, call service
 │   Service    │   Service      (03) business logic, talks to DB
 └──────┬───────┘
        ▼
 ┌──────────────┐   Interceptors (06) AFTER part: wrap/transform the response
 └──────┬───────┘
        ▼
   response JSON → CLIENT

   ✖ If anything above THROWS ──► Exception Filters (05) turn the error into an HTTP error response
```

---

## 🔁 How every topic session works

1. **Watch & code along** – course lessons (see [course-map.md](course-map.md)); code goes in this repo.
2. **Build the note** – using [_template.md](_template.md). Claude writes the explanations (verified against real runs where possible); **I write "In my own words" myself** (if I can't explain it, I don't know it yet).
3. **Practice** – build a small unit from the note's hints. Get it reviewed.
4. **Quiz** – in the note, on my own time. Wrong answers go to [mistakes-and-aha.md](mistakes-and-aha.md).
5. **Commit** – code + notes together.

Every 3rd day: **mixed review quiz** of older topics (spaced repetition).

## 🌱 Git commit convention

```
notes: exception filters
feat(user): throw NotFoundException instead of 200 error objects
practice: global http exception filter
```
