# Sessions

One file per working session (one branch's worth of work).
Notes 01–19 explain **concepts**; these files record **what happened in this project**:
what I built, what broke and why, what's still open.

Naming: `YYYY-MM-DD-topic.md`, newest first.

| Date | Session | Branch | Course lessons |
|---|---|---|---|
| 2026-09-22 | [Postgres in Docker + first TypeORM entity](2026-09-22-postgres-docker-typeorm.md) | `sql` → `main` | 20–25 |
| 2026-09-22 | [Relations: coffee ↔ flavors](2026-09-22-relations.md) | `relations` | 26–28 |

### Earlier (before this file existed)

| Dates | What | Branch |
|---|---|---|
| 2026-09-15 → 18 | Nest core: Express vs Nest, classes & `this`, modules/DI, shared state, filters, interceptors, pipes & validation (notes 01–07). Fixed real bugs found by testing: mass assignment, updates inheriting "email required", `/user/1abc` returning user 1. Discovered the tests had never run (Nest 12 packages are ES-module-only) and fixed the setup. Moved dependencies installed in the parent folder by mistake. | `main` |

### How I work

1. Start a branch per topic: `git checkout main && git pull && git checkout -b <topic>`
2. Follow the course lessons, commit as I go.
3. Write/extend the concept note + this session file.
4. Merge into `main` and push when the topic is done.
