# NestJS → Senior Backend Engineer: My Notes

> Frontend dev learning backend. I know functional JS, APIs, HTTP, what a DB and tokens are.
> Goal: understand **how things work behind the scenes, why they exist, and how NOT to do them**,
> and think like a senior backend engineer, not just "know Nest".

- Video I'm following: https://www.youtube.com/watch?v=Q6NpiIp-6WM
- After the video: the official NestJS course (same repo)
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
| 06 | Interceptors | RxJS just enough, response envelopes, logging/timing | ⏭️ next |
| 07 | Pipes & Validation | DTOs at runtime, trust boundaries | ⬜ |
| 08 | Middleware | Express middleware vs Nest layers | ⬜ |
| 09 | Guards | authentication vs authorization | ⬜ |

Extras:
- [mistakes-and-aha.md](mistakes-and-aha.md): quiz answers I got wrong, "aha" moments, corrections
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
 ┌──────────────┐   Middleware   (08) "generic stuff for many routes": cookies, CORS, logging
 └──────┬───────┘
        ▼
 ┌──────────────┐   Guards       (09) "are you ALLOWED in?" → no: 401/403, stop here
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

1. **Predict** – before watching the video section, answer 1–2 "what do you think happens?" questions.
2. **Watch & code along** – follow the video section.
3. **Behind the scenes** – bring questions/code; dig into how it really works + where it sits on the Big Map.
4. **Write the note** – using [_template.md](_template.md). Claude drafts the explanations; **I write "In my own words" myself** (if I can't explain it, I don't know it yet).
5. **Practice** – build a small unit with hints, not full solutions. Get it reviewed.
6. **Quiz** – senior-level multiple choice. Try first, then open the answer. Wrong answers go to [mistakes-and-aha.md](mistakes-and-aha.md).
7. **Commit** – code + notes together.

Every 3rd day: **mixed review quiz** of older topics (spaced repetition).

## 🌱 Git commit convention

```
notes: exception filters
feat(user): throw NotFoundException instead of 200 error objects
practice: global http exception filter
```
