# Session Log

What happened each working session: what I built, what broke, what's still open.
Notes explain *concepts*; this file records *this project's history*.

---

## 2026-09-19 → 2026-09-22 · Postgres in Docker + first real database table

### What I built

- **Postgres running in Docker** (`docker-compose.yaml`), course lessons 17–19.
  Docker Desktop was installed but the `docker` command wasn't found: its program lives in
  `~/.docker/bin`, which wasn't on the shell's search path. Fixed by adding one line to `~/.zshrc`.
- **Nest connected to it**, course lesson 20: `TypeOrmModule.forRoot({...})` in `app.module.ts`.
- **The coffee feature** (`src/coffee/`), course lessons 21–22:
  - `entity/coffee.entity.ts`: the class that describes the table
  - `coffee.module.ts`: `TypeOrmModule.forFeature([Coffee])`
  - `coffee.service.ts`: findAll / findById / create / updateById / deleteById
  - `coffee.controller.ts`: `GET /coffee`, `POST /coffee`
  - `dto/`: what a client may send
- **Tests for the coffee feature**: both generated test files were failing; they now use a fake
  table helper, so they run without Docker or a database. `pnpm test` → 15 passed.

### The table was never created by hand

`synchronize: true` + starting the app = TypeORM reads the entity classes and changes the database to match.
Verified with `docker compose exec db psql -U postgres -c "\d coffee"`:

```
 id     | integer           | not null | default nextval('coffee_id_seq')
 name   | character varying | not null |
 brand  | character varying | not null |
 flavor | json              |          |
```

### What broke, and why

| Problem | Cause | Fix |
|---|---|---|
| `docker: command not found` | Docker Desktop's program folder wasn't in the shell's search path | added it to `~/.zshrc` |
| `no configuration file provided` | ran `docker compose` from the **parent** folder | run it inside `nestjsmasterycourse/` |
| `POST /coffee` → 400 "property name should not exist" | `CreateCoffeeDto extends PartialType(Coffee)`: the entity's notes are for the database, the request checker keeps its own separate list, which was empty | gave the DTO its own rules (`@IsString()` etc.) |
| Sending `{ }` without `flavor` was rejected | `?` in TypeScript means nothing at runtime | added `@IsOptional()` |
| Coffee tests failed to start | the generated tests never provided the table helper the service asks for | provided a fake one with `getRepositoryToken(Coffee)` |

### Notes written

- **notes/09-database-docker-typeorm.md** — new, two parts:
  - Part A: Docker (why it exists, container vs virtual machine, images and layers, volumes, ports, the commands). Built from this machine's real output.
  - Part B: what the ORM does, the entity, `forRoot` / `forFeature` / `@InjectRepository` explained as three lines of plain JS, and a table of **the real SQL** each repository method runs (logged from our own database).
- **notes/07-pipes-validation.md** §6.1 — why DTO and entity stay separate, using the 400 error above.
- **notes/03-modules-controllers-providers-di.md** §3.4b — what `controllers`, `providers`, `imports` and `exports` mean.
- Comments added to every new file in `src/coffee/`, `app.module.ts` and `docker-compose.yaml`.

### Still open (my turn)

1. `updateById` returns `{ affected: 1 }` instead of the coffee → use `save(coffee)` after `preload`.
2. `findAll()` loads the whole table → add `take`/`skip` (course lesson 26).
3. Missing routes: `GET /coffee/:id`, `PATCH /coffee/:id`, `DELETE /coffee/:id` (service methods already exist).
4. `docker-compose.yaml`: no named place to keep data, so `down` + `up` empties the database. Also pin `postgres:18` and drop the obsolete `version:` line.
5. Delete the leftover `this;` experiment line in `user.controller.ts`.
6. Practice tasks in notes 07 (tasks 4–6) and 09.

### Useful commands from this session

```bash
docker compose up -d                                   # start Postgres (inside nestjsmasterycourse/)
docker compose exec db psql -U postgres                 # SQL shell (\dt tables, \d coffee, \q quit)
docker compose exec db psql -U postgres -P pager=off -c "select * from coffee;"
pnpm start:dev                                          # app + auto table sync
pnpm test                                               # 15 tests, no database needed
```

---

## 2026-09-15 → 2026-09-18 · Nest core (earlier sessions, summary)

- Notes 01–07: Express vs Nest, JS classes and `this`, modules/DI, shared state and the event loop,
  exception filters, interceptors, pipes and validation.
- Fixed real bugs found by testing the running app: mass assignment (`isAdmin` was saved), updates
  rejected because they inherited "email required", `/user/1abc` returning user 1.
- Discovered the test setup had never worked (Nest 12 ships ES-module-only packages, Node 22 + Jest
  needed ES-module mode). Tests run now.
- Dependencies had been installed in the parent folder by mistake; moved into the project.
