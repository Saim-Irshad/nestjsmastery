# 00 — The 20-Day Roadmap

> Started **2026-09-15** → target finish **2026-10-04**.
> Assumes ~3–4 focused hours/day. If a day slips, **don't skip the checkpoint days**. Squeeze a topic day instead.

## The idea behind this plan

Three tracks run side by side, every day:

```
 Track A: NestJS            → what the framework gives you          (the video, then the official course)
 Track B: JS / OOP / Node   → the language + runtime underneath     (classes, this, event loop, async)
 Track C: Backend & System  → how real systems behave in production (HTTP, DB, auth, scaling, failures)
```

Nest is the vehicle. **Track C is what makes you senior.** A junior knows *how to write* an interceptor;
a senior knows *when it's the wrong tool*, what it costs, and what breaks at 1000 req/s.

20 days is tight for the video + official course + system design. So:
**depth on core concepts** (they compound), **breadth on advanced ones** (know they exist, when to reach for them).

---

## Phase 1 — Nest core + foundations (Days 1–6) · Video 00:00 → 52:00

| Day | Nest (A) | JS / Node (B) | Backend / System (C) | Status |
|---|---|---|---|---|
| 1 | Express vs Nest, setup, modules & architecture | how Express works internally | feature-based folders, layers | ✅ |
| 2 | Controllers, providers, DI | classes, objects in memory, `this`, `new` | shared state, event loop, stateless HTTP | ✅ |
| 3 | Exception filters → **Interceptors** | Observables vs Promises (just enough RxJS) | error contracts, response envelopes, status codes | 🔄 |
| 4 | Pipes, DTO validation (`class-validator`), `ParseIntPipe` | runtime vs compile-time types | trust boundaries: never trust the client | ⬜ |
| 5 | Middleware, Guards, full request lifecycle | closures & `next()` chains | authentication vs authorization, sessions vs JWT (concept) | ⬜ |
| 6 | 🏁 **Checkpoint:** build a small "Bookmarks API" from an empty module without looking at notes | — | mixed review quiz | ⬜ |

## Phase 2 — Real app with the video (Days 7–11) · Video 52:00 → end

| Day | Nest (A) | JS / Node (B) | Backend / System (C) | Status |
|---|---|---|---|---|
| 7 | Project setup, config & env vars, Arcjet | `process.env`, module loading | **rate limiting** (token bucket, windows), bot protection, secrets handling | ⬜ |
| 8 | Database setup with the video's ORM | async/await with I/O, connection pools | schema, migrations, relations, **indexes**, N+1 queries | ⬜ |
| 9 | Better-Auth | cookies & headers from the server side | password hashing, sessions vs JWT for real, CSRF/XSS from the backend side | ⬜ |
| 10 | User module, interceptor, hackathon module | — | ownership checks ("can THIS user edit THIS thing?"), pagination | ⬜ |
| 11 | 🏁 **Checkpoint:** add a feature of your own to the video app (write a 1-page design first) | — | mixed review quiz | ⬜ |

## Phase 3 — Official course topics + depth (Days 12–17)

| Day | Nest (A) | JS / Node (B) | Backend / System (C) | Status |
|---|---|---|---|---|
| 12 | Testing: unit (mock providers) + e2e (supertest) | test doubles, why DI makes this easy | what to test, test pyramid | ⬜ |
| 13 | Custom providers (`useValue`/`useFactory`/`useClass`), scopes, dynamic modules | factories, tokens | cost of request scope, circular dependencies as a design smell | ⬜ |
| 14 | Transactions with the ORM | race conditions with `await` | **transactions, idempotency keys, optimistic locking**, double-submit | ⬜ |
| 15 | Caching, queues / background jobs | CPU vs I/O work, worker threads | Redis, cache invalidation, "never do slow work inside the request" | ⬜ |
| 16 | Logging, health checks, graceful shutdown | process signals, unhandled rejections | observability: structured logs, request IDs, 4xx vs 5xx alerts | ⬜ |
| 17 | Swagger/OpenAPI, versioning, file uploads | streams (taste) | API design: REST conventions, cursor vs offset pagination, breaking changes | ⬜ |

## Phase 4 — System design + capstone (Days 18–20)

| Day | Focus | Status |
|---|---|---|
| 18 | System design on paper: stateless services, load balancers, replicas, caching layers, queues. Design a "hackathon platform" for 100k users. | ⬜ |
| 19 | Capstone build: small but production-shaped API (auth, validation, DB, tests, logging, rate limiting, Docker) | ⬜ |
| 20 | Finish + deploy capstone. Mock senior interview: design question + debugging scenarios + review of own code. | ⬜ |

---

## Rules for myself
- If I can't write **"In my own words"** for a topic, it's not done.
- Wrong quiz answer → goes into [mistakes-and-aha.md](mistakes-and-aha.md) with *why* I got it wrong.
- Commit at the end of every topic: code + notes.
