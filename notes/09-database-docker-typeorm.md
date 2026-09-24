# 09 — Database, Docker & TypeORM

> 📍 **Where on the Big Map:** below the Service layer. The service asks the ORM, the ORM talks to Postgres, and Postgres runs inside a Docker container.
> 📘 **Official course:** lesson23 Before we start · lesson24 Docker · lesson25 Running PostgreSQL · lesson26 TypeORM Module · lesson27 Entity · lesson28 Repository (Part B)

```
 Controller → Service → TypeORM repository (Part B) → network → Postgres  ← inside a Docker container (Part A)
```

---

# Part A — Docker & running Postgres

## 1. The problem (why Docker exists)

Your app needs a database. The old way: go to postgresql.org, download an installer, install it on your Mac.

What goes wrong:
- **"Works on my machine."** You have Postgres 16, your teammate has 14, production has 17. A query works for you and breaks in prod.
- **Messy machine.** Project A needs Postgres 14, project B needs 18. Both want port 5432. Uninstalling leaves junk behind.
- **Onboarding.** A new dev spends a day installing Postgres, Redis, a queue... following an outdated README.
- **Different OS.** You develop on macOS, but production runs Linux. Some things behave differently.

**Docker's answer:** package the program **with everything it needs** (the OS files, libraries, config) into one bundle that runs the same way on every machine.
A new dev runs `docker compose up -d` and has the exact same Postgres as everyone else, in about a minute.

## 2. Mental model

**Shipping containers.** Before them, every cargo (barrels, sacks, cars) needed special handling. A standard box can be moved by any ship or crane without caring what's inside.
Docker is the standard box for software: Docker only needs to know how to run *a container*, not how to run Postgres.

Map it to things you know:

| Docker | Like... | In our project |
|---|---|---|
| **Image** | a **class** (note 02): a read-only recipe | `postgres` (Debian Linux + Postgres installed) |
| **Container** | an **object** made from the class with `new` | `nestjsmasterycourse-db-1`, running |
| **Registry** (Docker Hub) | the npm registry | where `postgres` was downloaded from |
| **Tag** (`postgres:18`) | a version in `package.json` | we used no tag → `latest` |
| **`docker-compose.yaml`** | `package.json` scripts + config, for a whole set of services | our file with the `db` service |
| **Volume** | a USB drive plugged into the container | where the database files should live |
| **Port mapping `5432:5432`** | a door from your Mac into the container | how Nest / TablePlus reach Postgres |

One image → many containers, just like one class → many objects. Each container has **its own** data, like each object has its own fields.

## 3. How it works behind the scenes

### 3.1 A container is NOT a virtual machine

A **virtual machine** fakes an entire computer: its own kernel (the core of the OS), its own boot. That's heavy: GBs of RAM, minutes to start.

A **container** is just a **normal process** (a running program) that the Linux kernel **isolates**:
- it gets its own **view** of the filesystem, the process list and the network (Linux "namespaces"),
- and **limits** on CPU/memory (Linux "cgroups").

It shares the host's kernel, which is why it starts in about 0.4s (your output said `Started 0.4s`).

**Proof from your container** (I ran commands inside it):
```
PRETTY_NAME="Debian GNU/Linux 13 (trixie)"   ← it thinks it's a Debian Linux machine
aarch64                                       ← ARM CPU (your M-series Mac)
PID 1 = postgres                              ← inside, Postgres is process #1: it can't see any other process on your Mac
```

### 3.2 But I'm on a Mac. Where's the Linux?

Containers need a **Linux** kernel, and macOS isn't Linux. So **Docker Desktop runs one small, hidden Linux VM**, and all your containers run inside it.

```
 Your Mac (macOS)
 ├── Terminal, VS Code, your Nest app (pnpm start:dev)
 └── Docker Desktop
      └── small Linux VM  (one, shared)
           └── container "db": Debian 13 + Postgres 18.6
```

That's why your `select version()` said *"on aarch64-unknown-linux-gnu … Debian"*: Postgres really is running on Linux.

### 3.3 Images are layers

An image isn't one big file. It's a stack of **read-only layers**, each one "a change on top of the previous":

```
 layer 13  ...Postgres config, entrypoint script
 ...
 layer 3   Postgres binaries installed
 layer 2   system libraries
 layer 1   Debian base filesystem
```
Your `postgres` image: **13 layers, 672 MB**. The first `docker compose up` took **159s** because it downloaded them.
Layers are cached and **shared**: a second image built on Debian reuses layer 1 instead of downloading it again.

A running container adds **one thin writable layer** on top. Every file Postgres writes goes there,
**and that layer is deleted when the container is deleted.** That's why databases need volumes (3.6).

### 3.4 What `docker compose up -d` actually did

```
1. Read docker-compose.yaml in the CURRENT folder        (wrong folder → "no configuration file provided")
2. Project name = folder name → "nestjsmasterycourse"
3. Image "postgres" not on this machine → pull all layers from Docker Hub
4. Create a private network  → nestjsmasterycourse_default
5. Create a container         → nestjsmasterycourse-db-1  (project-service-number)
6. Start it; its start command is docker-entrypoint.sh   (the COMMAND column in `docker compose ps`)
7. -d = "detached": run in the background and give me my terminal back
```

### 3.5 The entrypoint script, and why `POSTGRES_PASSWORD` works

`environment: POSTGRES_PASSWORD: pass123` sets an environment variable inside the container (like `process.env` in Node).
The image's start script `docker-entrypoint.sh` does roughly:

```sh
if [ data folder is EMPTY ]; then      # first start only
  create a new database cluster
  set the "postgres" user's password to $POSTGRES_PASSWORD
fi
start postgres
```

⚠️ **Only on the first start with an empty data folder.** Change the password in the YAML later and the old one stays, because the data folder already exists (Quiz Q2).

### 3.6 Volumes: where data survives

```
 Without a named volume:            With a named volume:
 container ──► writable layer       container ──► volume "pgdata"  (lives in Docker, not in the container)
 docker compose down → data gone    docker compose down → volume stays → next `up` reuses it
```

Our current file has **no `volumes:`**. The Postgres image then creates an **anonymous** volume with a random name
(ours: `04ba5f4e9507…`). After `down` + `up` the **new** container gets a **new, empty** anonymous volume, so your tables seem to vanish.
A **named** volume (`pgdata`) is found again by name.

Postgres 18 keeps its data under `/var/lib/postgresql` (older versions: `/var/lib/postgresql/data`), so that's the path to mount.

### 3.7 Networking and `localhost`

```
 Your Mac                              Docker network "nestjsmasterycourse_default"
 localhost:5432 ──── port mapping ───► db container :5432
 (Nest, TablePlus, psql)
```

- `'5432:5432'` = `'MAC_PORT:CONTAINER_PORT'`. `'5433:5432'` would mean "reach it on 5433 from the Mac".
- Inside a container, **`localhost` means that container itself**, not your Mac.
  Today Nest runs on your Mac, so `host: 'localhost'` is right. If Nest ever runs in a container too, it must use the **service name** `host: 'db'` (Compose gives each service a DNS name on the shared network).
- `0.0.0.0:5432` in `docker compose ps` = listening on **all** network interfaces, so other devices on the same Wi-Fi could reach it. `'127.0.0.1:5432:5432'` limits it to your Mac only.

### 3.8 What was the `(END)` screen?

`psql` sends long output to a **pager** (`less`) so you can scroll. `(END)` = bottom of the output. Press **`q`** to quit.
To skip the pager: `docker compose exec db psql -U postgres -P pager=off -c "select version();"`.

## 4. In our project

`docker-compose.yaml` (course version, what we run today):
```yaml
version: '3'              # obsolete: Docker prints a warning and ignores it
services:
  db:                     # service name (also its hostname on the Docker network)
    image: postgres       # no tag = postgres:latest (18.6 today, something else next year)
    restart: always       # restart if it crashes / when Docker Desktop starts
    ports:
      - '5432:5432'       # Mac port : container port
    environment:
      POSTGRES_PASSWORD: pass123   # used once, when the data folder is empty
```

**Recommended version** (same behavior + pinned + persistent + Mac-only):
```yaml
services:
  db:
    image: postgres:18
    restart: always
    ports:
      - '127.0.0.1:5432:5432'
    environment:
      POSTGRES_PASSWORD: pass123
    volumes:
      - pgdata:/var/lib/postgresql

volumes:
  pgdata:
```

**Daily commands** (run inside `nestjsmasterycourse/`):

| Command | What it does |
|---|---|
| `docker compose up -d` | create + start (or just start) in the background |
| `docker compose ps` | what's running, which ports |
| `docker compose logs -f db` | follow the logs (Ctrl+C to stop following) |
| `docker compose stop` / `start` | pause / resume, data kept |
| `docker compose down` | delete container + network (named volume kept) |
| `docker compose down -v` | delete **volumes too**: full database reset ⚠️ |
| `docker compose exec db psql -U postgres` | open a SQL shell inside the container (`\q` to quit) |
| `docker compose exec db bash` | a terminal *inside* the container (`exit` to leave) |
| `docker ps` / `docker images` / `docker volume ls` | all containers / images / volumes on the machine |

**Connection details** (TablePlus / DBeaver / TypeORM): host `localhost` · port `5432` · user `postgres` · password `pass123` · database `postgres`.

## 5. ❌ How NOT to do it

| Don't | What goes wrong |
|---|---|
| `image: postgres` with no tag | "latest" moves. A new teammate gets a different major version than you. Pin `postgres:18`. |
| Database without a named volume | `down` + `up` = empty database. Hours of test data gone. |
| `docker compose down -v` casually | `-v` deletes volumes, meaning **the data**. There's no undo. |
| Run compose commands from another folder | `no configuration file provided`, or worse, you control a different project's containers. |
| Commit real passwords in `docker-compose.yaml` | They're in git history forever. Use `.env` files (course lessons 41–47); `pass123` is only OK for local dev. |
| `host: 'localhost'` from inside another container | Points at itself → "connection refused". Use the service name (`db`). |
| Change `POSTGRES_PASSWORD` and expect it to apply | Only used when the data folder is empty. Change it with SQL, or reset the volume. |
| Treat a container like a pet server (`exec` in, install things by hand) | Lost the next time it's recreated. Containers are disposable; put changes in the image/compose file. |
| Expose `5432` to the internet on a server | Bots scan for open databases constantly. In production the DB is on a private network only. |

## 6. 🧠 Senior engineer lens

- **Containers are disposable, state is not.** Same rule as note 04 (stateless services): the container can die at any time; anything important must live in a volume or a managed database.
- **Dev/prod parity.** The point of Docker is that dev, CI and prod run the *same* image. Pinned tags make that real.
- **In production, databases often aren't in containers you manage.** Teams use managed services (AWS RDS, Cloud SQL, Neon) that handle backups, failover and upgrades. Docker is still perfect for local dev and for **test databases in CI** (course lesson70 sets up a test DB).
- **Config comes from the environment.** `POSTGRES_PASSWORD` is the "12-factor" idea: the same image, configured by env vars per environment. Your Nest app will do the same with `ConfigModule` (lessons 41–47).
- **What's next at scale:** Compose runs containers on **one** machine. Kubernetes (and similar) runs them across **many** machines, restarts them, and scales them. Same image/container ideas.

## 7. 🔗 Connects to
- [02 — Classes](02-js-classes-objects-this.md): image = class, container = instance
- [04 — Shared state](04-requests-shared-state-event-loop.md): disposable processes, state lives elsewhere
- 14 — Configuration & Secrets: env vars, `.env`, not committing passwords
- 18 — Testing: throwaway test databases in Docker

## 8. ✍️ In my own words
> _(write here)_

## 9. 🛠️ Practice (Part A)

1. **Look inside.** `docker compose exec db bash`, then `cat /etc/os-release`, `ls /`, `ps aux`. Where are you? What can't you see? `exit` to leave.
2. **Lose data on purpose.** In `psql`: `create table test (id int); insert into test values (1);`. Then `docker compose down && docker compose up -d`. Is the table still there? Why?
3. **Keep data.** Switch to the recommended YAML (named volume), repeat step 2. Now what?
4. **The password trap.** With the volume in place, change `POSTGRES_PASSWORD` to `newpass`, run `docker compose up -d`, and try to log in from TablePlus with `newpass`. What happens and why?
5. **Two Postgres at once.** Add a second service `db2` on `'5433:5432'`. Connect to both. Are their tables shared?

<details><summary>Hints</summary>

- 1: You're in Debian, as root, and `ps` shows only Postgres processes: the process isolation from 3.1.
- 2: No named volume → a new anonymous volume → empty database.
- 4: The entrypoint only uses the variable when the data folder is empty (3.5). Change it with SQL:
  `ALTER USER postgres PASSWORD 'newpass';`, or `down -v` to start over.
- 5: Two containers = two objects of the same class = separate data.

</details>

## 10. ❓ Quiz (Part A)

**Q1.** Later you put the Nest app itself in a container in the same compose file. TypeORM still uses `host: 'localhost'`. What happens?

- A) Works, since everything is on the same laptop
- B) Connection refused: inside the Nest container, `localhost` is the Nest container itself. Use `host: 'db'`.
- C) Works only if ports are mapped
- D) Docker rewrites localhost automatically

<details><summary>Answer</summary>

**B.** Every container has its own network namespace. On the Compose network, services find each other by **service name**.
Port mappings (`5432:5432`) are only for reaching containers **from the host**; container-to-container traffic doesn't need them.

</details>

**Q2.** The DB has been running for a week with a named volume. You change `POSTGRES_PASSWORD` from `pass123` to `S3cure!` and run `docker compose up -d`. Which password works?

- A) `S3cure!`
- B) `pass123`: the entrypoint only applies the variable when initializing an empty data folder
- C) Both
- D) Neither, the container fails to start

<details><summary>Answer</summary>

**B.** Many "can't connect after changing the password" support threads are this. Env vars that **initialize** state aren't the same as settings read on every start.

</details>

**Q3.** Why did `select version()` say *"on aarch64-unknown-linux-gnu … Debian"* when you're on macOS?

- A) Docker converts Postgres to macOS
- B) Containers need a Linux kernel, so Docker Desktop runs a small Linux VM; the container is a Debian userland on that kernel, on your ARM CPU
- C) The image was built wrong
- D) macOS is Linux

<details><summary>Answer</summary>

**B.** On Linux servers there's no extra VM: containers run directly on the host kernel. That's one reason Docker is faster on Linux than on Mac/Windows.

</details>

**Q4.** No `volumes:` in the compose file. You create tables, run `docker compose down`, then `docker compose up -d`. What do you see?

- A) Same tables, since Docker keeps everything
- B) Empty database: the new container got a new anonymous volume; the old data sits orphaned in an unnamed volume
- C) Error: volume missing
- D) Tables exist but are empty

<details><summary>Answer</summary>

**B.** The data isn't deleted (the anonymous volume still exists, see `docker volume ls`), but nothing points at it anymore. Named volumes fix that.

</details>

**Q5.** A teammate says: "Let's run production Postgres with this same docker-compose file on one cloud server, since it works locally." What's the strongest senior concern?

- A) Docker is slower than native
- B) It's a single machine with no backups, failover or monitoring; one disk failure or a `down -v` loses everything. Production data needs backups, replication and access control (often a managed DB).
- C) Compose files don't work on Linux
- D) Postgres doesn't run in containers

<details><summary>Answer</summary>

**B.** Running the container is the easy part. **Operating a database** (backups you have actually restored, upgrades, replicas, monitoring, security) is the hard part, and why managed databases exist.

</details>

---

# Part B — TypeORM: entities & repositories (lessons 20–22)

## 1. The problem (why an ORM exists)

Without one, you write SQL strings and translate rows by hand:

```ts
const { rows } = await pool.query('SELECT id, name, brand FROM coffee WHERE id = $1', [id]);
const coffee = { id: rows[0].id, name: rows[0].name, brand: rows[0].brand };   // by hand, every time
```

Annoying parts: mapping rows ↔ objects, no types, every table needs the same 5 functions,
schema changes mean hunting strings, and one forgotten `$1` placeholder = **SQL injection**.

An **ORM** (Object-Relational Mapper) maps **classes ↔ tables** and **objects ↔ rows**:

```
 class Coffee   ←→  table "coffee"
 a Coffee object ←→ one row
 coffee.name     ←→ column "name"
```

You call `repo.find()`, it writes the SQL and hands back typed objects.

## 2. Mental model

```
 Entity      = the SHAPE  ("a coffee row has id, name, brand, flavor")   → a class with decorators
 Repository  = the WORKER ("go fetch/save coffees for me")               → object with find/save/delete
 DataSource  = the CONNECTION (pool of open connections to Postgres)     → created once by forRoot
```

Frontend link: the repository is like a typed `fetch` wrapper for one resource (`userApi.getAll()`, `userApi.save()`), except it talks SQL instead of HTTP.

## 3. How it works behind the scenes

### 3.1 The whole chain (four links)

```
 docker-compose.yaml      Postgres running on localhost:5432            (Part A)
        ▼
 TypeOrmModule.forRoot({...})   in AppModule
        → connects at startup, opens a POOL of connections
        → with synchronize:true, compares entities to tables and alters the DB
        ▼
 TypeOrmModule.forFeature([Coffee])   in CoffeeModule
        → registers a PROVIDER: "CoffeeRepository" = a Repository<Coffee>
        ▼
 constructor(@InjectRepository(Coffee) private readonly coffeeRepositery: Repository<Coffee>)
        → DI hands that provider to the service                          (note 03)
```

Break any link and you get a startup error. Forget `forFeature` and it's the familiar
`Nest can't resolve dependencies of the CoffeeService (?)`.

### 3.1b `forRoot`, `forFeature` and the repository, in plain words

**Write it yourself, without Nest or TypeORM, and you'd write these three lines:**

```js
// 1. open the connection to Postgres, ONCE, when the app starts
const db = await connectToPostgres({ host: 'localhost', password: 'pass123' });

// 2. make a little helper object for the coffee table
const coffeeTable = {
  find: ()  => db.query('SELECT * FROM coffee'),
  save: (c) => db.query('INSERT INTO coffee (name, brand) VALUES ($1, $2)', [c.name, c.brand]),
};

// 3. hand that helper to the service
const coffeeService = new CoffeeService(coffeeTable);
```

Those three lines are exactly our three pieces:

| Our code | What it is, plainly |
|---|---|
| `TypeOrmModule.forRoot({...})` in `AppModule` | line 1: **open the connection**, once, at startup |
| `TypeOrmModule.forFeature([Coffee])` in `CoffeeModule` | line 2: **make the helper for the coffee table** |
| `@InjectRepository(Coffee) repo: Repository<Coffee>` | line 3: **hand that helper to the service** |

**The repository IS that helper: a bag of functions for one table** (`find`, `save`, `delete`, `update`).
TypeORM wrote those functions instead of you, and it knows the table is `coffee` with columns `name`/`brand`
because it read the decorators on the `Coffee` class.

**Why is the connection opened separately from the helper?** Opening a connection to Postgres is slow, and you want
one, shared. So it happens once in `AppModule`, and every table helper reuses it:

```
AppModule:     forRoot({...})        → ONE open connection
                     │
CoffeeModule:  forFeature([Coffee])  → coffee helper  ─► CoffeeService
UserModule:    forFeature([User])    → user helper    ─► UserService
```

**Why must you write `@InjectRepository(Coffee)` when the type already says `Repository<Coffee>`?**
When TypeScript is compiled to JavaScript, `<Coffee>` is erased. The running code only sees "a repository", not
which table. The decorator is you saying "the coffee one".

Need coffee data in another module? Put `forFeature([Coffee])` in that module too. Helpers are cheap; the
connection stays shared.

What we actually printed from the project (2026-09-22), if you want to see it isn't magic:
```
forRoot  → { module, imports }        imports = the piece that opens and holds the connection (marked global,
                                      which is why every module can reach it)
forFeature([Coffee]) → { module, providers, exports }
           providers = [ { provide: 'CoffeeRepository', inject: ['DataSource'] } ]
                       "make an object called CoffeeRepository, using the open connection"
```

Two names you'll keep seeing: **`forRoot` = set this up once for the whole app**, **`forFeature` = set it up for this
one feature folder**. `ConfigModule`, `JwtModule` and `MongooseModule` use the same pair.

### 3.2 The entity: a class that describes a table

```ts
@Entity()                        // "this class is a table" (default name: class name lowercased → "coffee")
export class Coffee {
  @PrimaryGeneratedColumn()      // integer primary key; Postgres generates it (a SEQUENCE)
  id: number;

  @Column()                      // type guessed from TS: string → varchar, NOT NULL by default
  name: string;

  @Column()
  brand: string;

  @Column({ type: 'json', nullable: true })   // explicit type; NULL allowed
  flavor?: string[];
}
```

Real table Postgres created (`\d coffee`):
```
 id     | integer           | not null | default nextval('coffee_id_seq'::regclass)
 name   | character varying | not null |
 brand  | character varying | not null |
 flavor | json              |          |
 Indexes: PRIMARY KEY, btree (id)
```
`@Column()` decorators are **metadata** (note 03): TypeORM reads them to know the table shape.
They are a **different system** from class-validator's rules, which is why a DTO needs its own decorators (note 07 §6.1).

### 3.3 Why `@InjectRepository(Coffee)` is needed at all

You might expect this to be enough:
```ts
constructor(private readonly repo: Repository<Coffee>) {}   // ❌
```
It isn't, because **generics are erased at compile time**. At runtime Nest only sees `Repository`, and can't tell
`Repository<Coffee>` from `Repository<User>`. (Same reason an interface can't be injected, note 03 Q3.)

So `forFeature([Coffee])` registers each repository under a **token**, and the decorator says which one to inject:

```ts
// what forFeature([Coffee]) roughly adds to the module's providers
{
  provide: getRepositoryToken(Coffee),     // the string "CoffeeRepository"
  useFactory: (dataSource) => dataSource.getRepository(Coffee),
  inject: [DataSource],
}

// what @InjectRepository(Coffee) does
@Inject(getRepositoryToken(Coffee))        // "give me the provider registered under 'CoffeeRepository'"
```

`Repository<Coffee>` in the type position is then only for **TypeScript**: it makes `find()` return `Coffee[]`
instead of `any[]`, and catches typos in `where: { ... }`.

### 3.4 What each method really runs (logged from our own DB, 2026-09-22)

Turn this on yourself with `logging: true` in `forRoot`.

| Call | SQL it ran | Returned |
|---|---|---|
| `repo.create({...})` | **none** | a `Coffee` **object in memory**, `id: undefined` |
| `repo.save(coffee)` | `START TRANSACTION` → `INSERT INTO "coffee"("name","brand","flavor") VALUES ($1,$2,$3) RETURNING "id"` → `COMMIT` | the entity **with its new id** |
| `repo.find()` | `SELECT "Coffee"."id", ... FROM "coffee" "Coffee"` (no LIMIT ⚠️) | `Coffee[]` |
| `repo.findOne({ where: { id } })` | `SELECT ... FROM "coffee" WHERE "id" = $1 LIMIT 1` | `Coffee` or **`null`** |
| `repo.preload({ id, ...dto })` | `SELECT ... WHERE "id" = $1` | existing row **merged** with your changes, or **`undefined`** if the id doesn't exist |
| `repo.save(preloaded)` | `SELECT` (check) → `UPDATE "coffee" SET "name" = $1 WHERE "id" = $2` (**only changed columns**) | the updated **entity** |
| `repo.update(id, {...})` | `UPDATE "coffee" SET "brand" = $1 WHERE "id" = $2` (no SELECT) | `UpdateResult { affected: 1 }` (**not** the entity) |
| `repo.delete(id)` | `DELETE FROM "coffee" WHERE "id" = $1` | `DeleteResult { affected: 1 }` |

Three things to take from that table:

1. **`create()` doesn't touch the database.** It builds the object (and it really is `instanceof Coffee`). `save()` writes.
2. **`save()` decides INSERT vs UPDATE** by whether the entity has a primary key. That's why `preload()` + `save()` is the update recipe: `preload` fetches the row and merges your DTO into it, so `save` updates instead of inserting.
3. **`$1`, `$2` are parameters, not string concatenation.** The value travels separately from the SQL text, so `'; DROP TABLE coffee;--` is stored as text. **This is what prevents SQL injection**, and it's why you never build SQL with template strings.

### 3.5 `save()` vs `update()`

| | `save(entity)` | `update(id, partial)` |
|---|---|---|
| Returns | the entity | `UpdateResult` |
| Loads the row first | yes (knows what changed) | no |
| Runs entity hooks / cascades to relations | yes | **no** |
| Good for | normal updates, relations (lesson31) | bulk/simple column updates (`update({}, { recommendations: 0 })`) |

### 3.6 The connection pool

`forRoot` doesn't open one connection per request. It opens a **pool** (node-postgres defaults to 10) and lends
connections out. Each query borrows one and gives it back.

```
 request A ┐
 request B ├─► pool [conn1..conn10] ─► Postgres
 request C ┘   (11th waits for a free one)
```

This is the note 04 event loop in action: `await repo.find()` releases the thread while Postgres works,
so other requests keep being served. It also means **slow queries block the pool**, not just the client that asked.

## 4. In our project

`CoffeeService` ([src/coffee/coffee.service.ts](../src/coffee/coffee.service.ts)) is a textbook repository-backed service:
`findAll`, `findById` (404 when missing), `create` (`create` + `save`), `deleteById`, `updateById` (`preload`).

Two things to fix (see Practice):
- **`updateById` returns `UpdateResult`, not the coffee.** It does `preload(...)` (a SELECT) and then `update(id, coffee)`,
  so the client gets `{"generatedMaps":[],"raw":[],"affected":1}`. Use `return this.coffeeRepositery.save(coffee)`:
  the row is already loaded, and `save` returns the updated entity (and handles relations later in lesson31).
- **`findAll()` has no pagination.** Fine with 3 rows, fatal with 3 million (lesson32).

## 5. ❌ How NOT to do it

| Don't | What goes wrong |
|---|---|
| `repo.create(dto)` and expect it saved | Nothing was written. `create` is memory-only; `save` writes. |
| Use `find()` with no `take`/`skip` on a growing table | One request pulls the whole table into RAM and can take the app down. Always paginate (lesson32). |
| `update()` when you need the updated entity or relation cascades | You get `UpdateResult`, and related rows aren't touched. |
| Assume `findOne` throws when missing | It returns `null`. Check and throw `NotFoundException` yourself (your `findById` does this ✅). |
| Build SQL with template strings (`WHERE id = ${id}`) | SQL injection. Repositories/QueryBuilder parameterize for you. |
| Return entities straight to the client forever | Internal columns (`passwordHash`, `ownerId`) leak. Map to a response shape (note 07 §6.1). |
| Loop `await repo.save(x)` over 1000 items | 1000 round trips. Pass an array: `repo.save(items)` (one batched call). |
| Leave `synchronize: true` outside local dev | It rewrites the schema to match entities: a rename can **drop a column with its data** (lesson32: migrations). |
| Forget `forFeature` in the feature module | `Nest can't resolve dependencies of the CoffeeService (?)` at startup. |

## 6. 🧠 Senior engineer lens

- **An ORM is a leaky abstraction.** It writes SQL for you, but you own the SQL. Keep `logging: true` on in dev, read the queries, and learn to spot `SELECT` with no `LIMIT`, missing indexes (lesson31), and N+1 (lesson30).
- **The repository is a seam.** Your service depends on "something with `find`/`save`", so unit tests inject a fake with `getRepositoryToken(Coffee)` and never touch a database (lesson68). That's DI paying off again (note 03).
- **The database is usually the bottleneck**, not Node. Pool size, slow queries and missing indexes decide your throughput long before your JS does.
- **Entity ≠ API model ≠ domain model.** They start identical and drift. Keeping the DTO separate (note 07 §6.1) is what lets the DB change without breaking clients.
- **Anything that must happen together needs a transaction** (lesson30). Two `save()` calls in a row are two independent writes: a crash in between leaves half-written data.

## 7. 🔗 Connects to
- [03 — DI](03-modules-controllers-providers-di.md): tokens, `useFactory`, why generics can't be injected
- [04 — Shared state & event loop](04-requests-shared-state-event-loop.md): pools, `await`, slow queries blocking everyone
- [07 — Pipes & Validation](07-pipes-validation.md) §6.1: DTO vs entity
- 10 — Relations & pagination · 11 — Transactions, indexes, migrations

## 8. ✍️ In my own words
> _(write here)_

## 9. 🛠️ Practice (Part B)

1. **See the SQL.** Add `logging: true` to `forRoot`, restart, and hit every coffee route. Match each request to its query.
2. **Fix `updateById`** so the API returns the updated coffee (one-line change, section 4). Confirm with Thunder Client.
3. **`create` without `save`.** Comment out the `save` line, POST a coffee, then `GET /coffee`. Where did it go?
4. **Paginate `findAll`**: accept `?limit=10&offset=0` and pass `{ take, skip }`. What SQL appears? (Compare with lesson32.)
5. **Unit-test the service with a fake repo**, no database:
   ```ts
   { provide: getRepositoryToken(Coffee), useValue: { find: jest.fn(), findOne: jest.fn() } }
   ```
   Test that `findById` throws `NotFoundException` when the fake returns `null`.

<details><summary>Hints</summary>

- 2: `preload` already ran the SELECT, so you hold a full entity. `save(coffee)` updates and returns it.
- 4: `repo.find({ take: limit, skip: offset })` → `LIMIT`/`OFFSET` in the SQL.
- 5: `getRepositoryToken` comes from `@nestjs/typeorm`. Remember `import { jest } from '@jest/globals'` (our ESM setup).

</details>

## 10. ❓ Quiz (Part B)

**Q1.** Why can't Nest inject `Repository<Coffee>` from the type alone?

- A) Repositories aren't `@Injectable()`
- B) Generics are erased at compile time, so at runtime Nest only sees `Repository` and can't tell which entity. `forFeature` registers it under a token, and `@InjectRepository(Coffee)` asks for that token.
- C) TypeORM forbids it
- D) It works; the decorator is optional

<details><summary>Answer</summary>

**B.** Same root cause as "you can't inject an interface" (note 03 Q3): **types don't exist at runtime, tokens do.**

</details>

**Q2.** `const c = repo.create(dto);` and you return `c` without calling `save`. What does the client see, and what's in the DB?

- A) Client gets the coffee with an id; row saved
- B) Client gets a coffee object with `id: undefined`; the database has nothing
- C) An error
- D) Row saved without id

<details><summary>Answer</summary>

**B.** `create` only builds an object (it is `instanceof Coffee`, useful for hooks/defaults). Verified: no SQL runs at all until `save`.

</details>

**Q3.** Your `updateById` ends with `return this.coffeeRepositery.update(id, coffee)`. What does the API return?

- A) The updated coffee
- B) `{"generatedMaps":[],"raw":[],"affected":1}` — an `UpdateResult`, so the frontend can't show the new values without a second request
- C) 204 No Content
- D) The old coffee

<details><summary>Answer</summary>

**B.** Verified against our DB. `save(coffee)` returns the entity instead. Also `update()` skips cascades, which will matter once coffees have flavors (lesson31).

</details>

**Q4.** `GET /coffee` calls `repo.find()` with no options. The table grows to 2 million rows. What happens on the first request after that?

- A) TypeORM paginates automatically
- B) `SELECT` with no LIMIT: Postgres returns everything, Node builds 2M objects, memory spikes, the event loop stalls and other requests time out
- C) Postgres refuses
- D) Only slower for that one client

<details><summary>Answer</summary>

**B.** And it hurts **everyone**, because one process serves all requests (note 04). Always paginate, and cap the page size server-side.

</details>

**Q5.** A teammate writes `` repo.query(`SELECT * FROM coffee WHERE name = '${name}'`) ``. Why is that dangerous, and why is `findOne({ where: { name } })` safe?

- A) No real difference
- B) The string version lets input become SQL (`'; DROP TABLE coffee;--`). The repository sends `WHERE name = $1` with the value as a separate parameter, so it's always data, never code.
- C) It's only a performance issue
- D) Postgres blocks it

<details><summary>Answer</summary>

**B.** Our logs show `$1` parameters everywhere. When you do need raw SQL, pass parameters: `repo.query('... WHERE name = $1', [name])`.

</details>
