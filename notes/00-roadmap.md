# 00 — The 20-Day Roadmap (v2)

> Started **2026-09-15** → target finish **2026-10-04**.
> **v2 (2026-09-18):** switched from the YouTube video to the **official NestJS Fundamentals course** after the Pipes section.
> Lesson numbers = video file numbers, see [course-map.md](course-map.md).
> Assumes ~3–4 focused hours/day. If a day slips, **don't skip the checkpoint day**. Squeeze a topic day instead.

## The idea behind this plan

Three tracks run side by side, every day:

```
 Track A: NestJS            → what the framework gives you          (official course)
 Track B: JS / OOP / Node   → the language + runtime underneath     (classes, this, event loop, async)
 Track C: Backend & System  → how real systems behave in production (HTTP, DB, auth, scaling, failures)
```

Nest is the vehicle. **Track C is what makes you senior.** A junior knows *how to write* an interceptor;
a senior knows *when it's the wrong tool*, what it costs, and what breaks at 1000 req/s.

---

## Phase 1 — Nest core + foundations (Days 1–5) · YouTube video + course lessons 1–16

| Day | Date | Nest (A) | Backend / System (C) | Note | Status |
|---|---|---|---|---|---|
| 1 | 09-15 | Express vs Nest, setup, modules & architecture | feature folders, layers | 01 | ✅ |
| 2 | 09-16 | Controllers, providers, DI; JS classes & `this` | shared state, event loop, stateless HTTP | 02 03 04 | ✅ |
| 3 | 09-17 | Exception filters, interceptors | error contracts, response envelopes | 05 06 | ✅ |
| 4 | 09-18 | Pipes & validation · course lessons 13–16 | trust boundary, mass assignment | 07 | ✅ |
| 5 | 09-19 | Course lessons 1–12 (fast, mostly review) + note 07 practice | status codes, PUT vs PATCH, idempotency, pagination basics | 08 | ⬜ |

## Phase 2 — Data (Days 6–8) · lessons 17–29

| Day | Date | Nest (A) | Backend / System (C) | Note | Status |
|---|---|---|---|---|---|
| 6 | 09-20 | Docker, Postgres, TypeORM module, entities, repositories (17–22) | what an ORM does, connection pools, containers | 09 | ⬜ |
| 7 | 09-21 | Relations, cascades, pagination (23–26) | foreign keys, N+1 queries, offset vs cursor pagination | 10 | ⬜ |
| 8 | 09-22 | Transactions, indexes, migrations (27–29) | ACID, race conditions, how indexes work, safe schema changes | 11 | ⬜ |

## Phase 3 — Nest internals & building blocks (Days 9–13) · lessons 30–57

| Day | Date | Nest (A) | Backend / System (C) | Note | Status |
|---|---|---|---|---|---|
| 9 | 09-23 | DI deep dive, encapsulation, custom providers (30–37) | depend on abstractions, swapping implementations | 03 🔄, 12 | ⬜ |
| 10 | 09-24 | Dynamic modules, scopes (38–40), config (41–47) | 12-factor config, secrets, fail-fast startup | 13, 14 | ⬜ |
| 11 | 09-25 | Binding, filters, guards, metadata, interceptors, timeouts, custom pipes (48–55) | authn vs authz, API keys | 15, 05–07 🔄 | ⬜ |
| 12 | 09-26 | Middleware, param decorators (56–57), Swagger (58–62) | request logging, API contracts | 16, 17 | ⬜ |
| 13 | 09-27 | 🏁 **Checkpoint:** build a small API from scratch (Postgres + validation + guards + config) without notes | mixed review quiz | — | ⬜ |

## Phase 4 — Quality, Mongo, Auth (Days 14–17)

| Day | Date | Focus | Note | Status |
|---|---|---|---|---|
| 14 | 09-28 | Testing: unit + e2e (63–68) | 18 | ⬜ |
| 15 | 09-29 | MongoDB + Mongoose (69–76): fast; focus on **SQL vs NoSQL** trade-offs | 19 | ⬜ |
| 16 | 09-30 | Auth course (course 2), part 1: hashing, sessions vs JWT, guards | 20+ | ⬜ |
| 17 | 10-01 | Auth course, part 2: authorization, roles/permissions | 20+ | ⬜ |

## Phase 5 — System design + capstone (Days 18–20)

| Day | Date | Focus | Status |
|---|---|---|---|
| 18 | 10-02 | System design: stateless services, load balancers, replicas, caching, queues, rate limiting. Picks from the Advanced Concepts course. | ⬜ |
| 19 | 10-03 | Capstone build: auth, validation, Postgres, tests, logging, config, Docker | ⬜ |
| 20 | 10-04 | Finish + deploy capstone. Mock senior interview: design question + debugging scenarios + own code review. | ⬜ |

Dropped: the YouTube video's build section (Arcjet, Better-Auth). Rate limiting and auth are covered on Days 16–18 instead.

---

## Rules for myself
- If I can't write **"In my own words"** for a topic, it's not done.
- Wrong quiz answer → goes into [mistakes-and-aha.md](mistakes-and-aha.md) with *why* I got it wrong.
- Commit at the end of every topic: code + notes.
