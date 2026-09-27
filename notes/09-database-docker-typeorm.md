# 09 — Database, Docker & TypeORM

> 📍 **Where on the Big Map:** below the Service layer. The service asks the ORM, the ORM talks to Postgres, and Postgres runs inside a Docker container.
> 📘 **Official course:** video20 Before we start · video21 Install Docker · video22 Running PostgreSQL (Part A) · video23 TypeORM Module · video24 Entity · video25 Repository (Part B) (file numbers per `course-map.md`)

```
 Controller → Service → TypeORM repository (Part B) → network → Postgres  ← inside a Docker container (Part A)
```

---

# Part A — Docker & running Postgres

## 1. The problem

Up to now `UserService` kept its users in an array on the one shared service object (`src/user/user.service.ts:84`). Every restart, and every `--watch` reload after a file save, wiped it. The coffee feature needs data that survives, which means a real database, which means Postgres has to be running somewhere before `pnpm start:dev` can connect to it.

The old way to get it running: go to postgresql.org, download the installer, install it on your Mac, and write the steps into the README:

```
Setup
1. Install Postgres 16 from postgresql.org (or `brew install postgresql@16`)
2. Start it: `brew services start postgresql@16`
3. Create the user: `createuser -s postgres`
4. Set the password: `psql -c "ALTER USER postgres PASSWORD 'pass123'"`
```

What goes wrong with that:

- **"Works on my machine."** You have Postgres 16, your teammate has 14, production has 17. A query works for you and breaks in prod.
- **Messy machine.** Project A needs Postgres 14, project B needs 18. Both want port 5432. Uninstalling leaves junk behind.
- **Onboarding.** A new dev spends a day installing Postgres, Redis, a queue... following a README that was right eight months ago.
- **Different OS.** You develop on macOS, production runs Linux. Some things behave differently, and you find out in prod.

What you want instead is to package the program **with everything it needs** (the OS files, libraries, config) into one bundle that runs the same way on every machine, so that a new dev types one command and has the exact same Postgres as everyone else, in about a minute. That's the job Docker does.

## 2. Mental model

Before shipping containers existed, every kind of cargo (barrels, sacks, cars) needed its own special handling at every port. A standard steel box changed that: any ship or crane can move the box without caring what's inside. Docker is that box for software. Docker only needs to know how to run *a container*; it doesn't need to know anything about Postgres.

Mapping the pieces onto things you already know:

| Docker word | Like... | In this project |
|---|---|---|
| **Image** | a **class** (note 02): a read-only recipe | `postgres` (Debian Linux + Postgres installed) |
| **Container** | an **object** made from the class with `new` | `nestjsmasterycourse-db-1`, running |
| **Registry** (Docker Hub) | the npm registry | where `postgres` was downloaded from |
| **Tag** (`postgres:18`) | a version in `package.json` | we used no tag, so we got `latest` |
| **`docker-compose.yaml`** | `package.json` scripts + config, for a whole set of services | our file with the `db` service |
| **Volume** | a USB drive plugged into the container | where the database files should live |
| **Port mapping `5432:5432`** | a door from your Mac into the container | how Nest / TablePlus reach Postgres |

One image gives you many containers, the way one class gives you many objects. Each container has **its own** data, the way each object has its own fields.

## 3. Baby steps

### 3.1 Naive: install Postgres on the Mac

The README from section 1. It works on the day you write it. What breaks is everything in section 1's list, and it breaks slowly: months later, on somebody else's laptop, for reasons that have nothing to do with your code.

### 3.2 Better: one command that runs a ready-made Postgres

Docker Hub has a ready-made Postgres bundle. One command downloads it and starts it:

```sh
docker run -d -e POSTGRES_PASSWORD=pass123 -p 5432:5432 postgres
```

Same Postgres on every machine, no installer, `docker rm` leaves nothing behind. What's still wrong: that command lives in someone's shell history. The new dev doesn't know the flags, the password isn't in git, and when the project grows to Postgres plus Redis plus a queue, nobody remembers the three commands and their order.

### 3.3 Better: write the command down as a file

Put the same information in a file next to the code, and let one command read it. This is the course version, and what `docker-compose.yaml` in this repo does today:

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

`docker compose up -d` reads it and does what section 3.2's command did. The file is in git, so the new dev has it. That file is what Docker calls a **compose file**, the downloaded bundle is an **image**, and the running copy is a **container**.

What's still wrong, and each of these bit us or will:

- `image: postgres` with no version. "Latest" moves. Today it's 18.6; the teammate who joins next year gets 19.
- No place to keep the data. `docker compose down` followed by `up` gives you an **empty database** (section 4.6 explains why).
- `'5432:5432'` opens the door to anyone on the same Wi-Fi, not only to this Mac.
- `version: '3'` does nothing and prints a warning on every command.

### 3.4 What a senior does: pin the version, name the data, close the door

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

Same behavior, plus: the version is pinned, the data lives in a named place Docker finds again after `down` (a **named volume**), and the port is reachable from this Mac only. The password is still in the file, which is fine for local dev and wrong for anything else (course videos 44–50 move it into `.env`).

## 4. How it works underneath

### 4.1 A container is not a virtual machine

A **virtual machine** fakes an entire computer: its own kernel (the core of the OS), its own boot sequence. That's heavy: gigabytes of RAM, minutes to start.

A container is a **normal process** (a running program) that the Linux kernel **isolates**:

- it gets its own **view** of the filesystem, the process list and the network (Linux "namespaces"),
- and **limits** on CPU and memory (Linux "cgroups").

It shares the host's kernel, which is why it starts in about 0.4 s (`docker compose up` printed `Started 0.4s`).

Proof from this project's container (commands run inside it, 2026-09-22):

```
PRETTY_NAME="Debian GNU/Linux 13 (trixie)"   ← it thinks it's a Debian Linux machine
aarch64                                       ← ARM CPU (your M-series Mac)
PID 1 = postgres                              ← inside, Postgres is process #1: it can't see any other process on your Mac
```

### 4.2 But this is a Mac. Where's the Linux?

Containers need a **Linux** kernel, and macOS isn't Linux. So **Docker Desktop runs one small, hidden Linux VM**, and every container runs inside it:

```
 Your Mac (macOS)
 ├── Terminal, VS Code, your Nest app (pnpm start:dev)
 └── Docker Desktop
      └── small Linux VM  (one, shared)
           └── container "db": Debian 13 + Postgres 18.6
```

That's why `select version()` said *"on aarch64-unknown-linux-gnu … Debian"*: Postgres really is running on Linux. On a Linux server there's no extra VM; containers run directly on the host kernel, which is one reason Docker is faster there than on Mac or Windows.

### 4.3 Images are layers

An image isn't one big file. It's a stack of **read-only layers**, each one "a change on top of the previous":

```
 layer 13  ...Postgres config, entrypoint script
 ...
 layer 3   Postgres binaries installed
 layer 2   system libraries
 layer 1   Debian base filesystem
```

This project's `postgres` image: **13 layers, 672 MB**. The first `docker compose up` took **159 s** because it downloaded all of them. Layers are cached and **shared**: a second image built on Debian reuses layer 1 instead of downloading it again.

A running container adds **one thin writable layer** on top. Every file Postgres writes goes there, **and that layer is deleted when the container is deleted.** That's why databases need volumes (4.6).

### 4.4 What `docker compose up -d` did, step by step

```
1. Read docker-compose.yaml in the CURRENT folder        (wrong folder → "no configuration file provided")
2. Project name = folder name → "nestjsmasterycourse"
3. Image "postgres" not on this machine → pull all 13 layers from Docker Hub
4. Create a private network  → nestjsmasterycourse_default
5. Create a container         → nestjsmasterycourse-db-1  (project-service-number)
6. Start it; its start command is docker-entrypoint.sh   (the COMMAND column in `docker compose ps`)
7. -d = "detached": run in the background and give me my terminal back
```

### 4.5 The entrypoint script, and why `POSTGRES_PASSWORD` works

`environment: POSTGRES_PASSWORD: pass123` sets an environment variable inside the container, the same thing `process.env` reads in Node. The image's start script, `docker-entrypoint.sh`, does roughly:

```sh
if [ data folder is EMPTY ]; then      # first start only
  create a new database cluster
  set the "postgres" user's password to $POSTGRES_PASSWORD
fi
start postgres
```

⚠️ **Only on the first start with an empty data folder.** Change the password in the YAML later and the old one stays, because the data folder already exists and the `if` is skipped (Quiz Q2).

### 4.6 Volumes: where data survives

```
 Without a named volume:            With a named volume:
 container ──► writable layer       container ──► volume "pgdata"  (lives in Docker, not in the container)
 docker compose down → data gone    docker compose down → volume stays → next `up` reuses it
```

The current file has **no `volumes:`**. The Postgres image then creates an **anonymous** volume with a random name (ours: `04ba5f4e9507…`). After `down` + `up` the **new** container gets a **new, empty** anonymous volume, so the tables seem to vanish. The old data is still on disk in the old volume; nothing points at it anymore. A **named** volume (`pgdata`) is found again by name.

Postgres 18 keeps its data under `/var/lib/postgresql` (older versions: `/var/lib/postgresql/data`), so that's the path to mount.

### 4.7 Networking and `localhost`

```
 Your Mac                              Docker network "nestjsmasterycourse_default"
 localhost:5432 ──── port mapping ───► db container :5432
 (Nest, TablePlus, psql)
```

- `'5432:5432'` is `'MAC_PORT:CONTAINER_PORT'`. `'5433:5432'` would mean "reach it on 5433 from the Mac".
- Inside a container, **`localhost` means that container itself**, not your Mac. Today Nest runs on the Mac, so `host: 'localhost'` in `app.module.ts` is right. If Nest ever runs in a container too, it must use the **service name** `host: 'db'` (Compose gives each service a DNS name on the shared network).
- `0.0.0.0:5432` in `docker compose ps` means listening on **all** network interfaces, so other devices on the same Wi-Fi could reach it. `'127.0.0.1:5432:5432'` limits it to your Mac only.

### 4.8 What was the `(END)` screen?

`psql` sends long output to a **pager** (`less`) so you can scroll. `(END)` is the bottom of the output. Press **`q`** to quit. To skip the pager: `docker compose exec db psql -U postgres -P pager=off -c "select version();"`.

## 5. Functional vs class

There's no class in a YAML file, but the shape that note 02 taught is here anyway, and it's the fastest way to keep the words straight:

```js
// the image is the recipe; the container is one running copy made from it
class PostgresImage { /* Debian + Postgres binaries + entrypoint script: read-only */ }
const db1 = new PostgresImage({ password: 'pass123', port: 5432 });   // nestjsmasterycourse-db-1
const db2 = new PostgresImage({ password: 'other',   port: 5433 });   // a second, separate database
```

`db1` and `db2` share the recipe and nothing else: separate data, separate processes, separate ports. Functionally you'd write a factory `makePostgres(config)` returning a fresh closure, and the point is the same: the recipe is shared, the state is per copy. What the "class" buys you is the layer cache: every container made from `postgres:18` reuses the same 13 read-only layers on disk and only pays for its own thin writable layer.

## 6. In my project

`docker-compose.yaml` (course version, what we run today):

| Line | What it says |
|---|---|
| `docker-compose.yaml:24` | `version: '3'`, obsolete, safe to delete |
| `docker-compose.yaml:29` | the service is called `db` (its hostname on the Docker network) |
| `docker-compose.yaml:33` | `image: postgres`, no tag |
| `docker-compose.yaml:36` | `restart: always` |
| `docker-compose.yaml:44` | `'5432:5432'` |
| `docker-compose.yaml:50` | `POSTGRES_PASSWORD: pass123` |
| `docker-compose.yaml:52-63` | the comment describing the missing named volume |

The recommended version is in section 3.4.

**Daily commands** (run inside `nestjsmasterycourse/`):

| Command | What it does |
|---|---|
| `docker compose up -d` | create + start (or only start) in the background |
| `docker compose ps` | what's running, which ports |
| `docker compose logs -f db` | follow the logs (Ctrl+C to stop following) |
| `docker compose stop` / `start` | pause / resume, data kept |
| `docker compose down` | delete container + network (named volume kept) |
| `docker compose down -v` | delete **volumes too**: full database reset ⚠️ |
| `docker compose exec db psql -U postgres` | open a SQL shell inside the container (`\q` to quit) |
| `docker compose exec db bash` | a terminal *inside* the container (`exit` to leave) |
| `docker ps` / `docker images` / `docker volume ls` | all containers / images / volumes on the machine |

**Connection details** (TablePlus / DBeaver / TypeORM): host `localhost` · port `5432` · user `postgres` · password `pass123` · database `postgres`.

**What this machine printed** (2026-09-22): `Started 0.4s` on `up`; `select version()` reported *aarch64-unknown-linux-gnu … Debian*; the anonymous volume was `04ba5f4e9507…`; the image was 13 layers, 672 MB, first pull 159 s. Two setup problems from that session: `docker: command not found` (Docker Desktop's binaries live in `~/.docker/bin`, which wasn't on the shell's path; one line in `~/.zshrc` fixed it) and `no configuration file provided` (ran `docker compose` from the parent folder `nestjsmastery/` instead of `nestjsmasterycourse/`).

## 7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| `image: postgres` with no tag | "latest" moves. A new teammate gets a different major version than you, and a query that works for you fails for them | The new teammate, on day one, with no idea why |
| Database without a named volume | `down` + `up` = empty database | You, after losing hours of test data; a teammate who ran `down` to "clean up" |
| `docker compose down -v` casually | `-v` deletes volumes, meaning **the data**. There's no undo | Anyone whose data was in there |
| Run compose commands from another folder | `no configuration file provided`, or worse, you control a different project's containers | You, restarting the wrong project's database |
| Commit real passwords in `docker-compose.yaml` | They're in git history forever. Use `.env` files (course videos 44–50); `pass123` is only fine for local dev | The company, when the repo leaks or an ex-employee still has a clone |
| `host: 'localhost'` from inside another container | Points at itself, so "connection refused". Use the service name (`db`) | The first person to containerize the Nest app |
| Change `POSTGRES_PASSWORD` and expect it to apply | Only used when the data folder is empty. Change it with SQL, or reset the volume | Whoever spends an afternoon on "can't connect after changing the password" |
| Treat a container like a pet server (`exec` in, install things by hand) | Lost the next time it's recreated. Containers are disposable; put changes in the image or compose file | The person who inherits the setup and can't reproduce it |
| Expose `5432` to the internet on a server | Bots scan for open databases constantly. In production the DB is on a private network only | Every user whose data is in that database |

## 8. 🧠 Senior engineer lens

- **Containers are disposable, state is not.** Same rule as note 04 (stateless services): the container can die at any time; anything important must live in a volume or a managed database.
- **Dev/prod parity.** The point of Docker is that dev, CI and prod run the *same* image. Pinned tags make that real.
- **In production, databases often aren't in containers you manage.** Teams use managed services (AWS RDS, Cloud SQL, Neon) that handle backups, failover and upgrades. Docker is still perfect for local dev and for **test databases in CI** (course videos 69–71 set up a test DB for e2e tests).
- **Config comes from the environment.** `POSTGRES_PASSWORD` is the "12-factor" idea: the same image, configured by env vars per environment. The Nest app will do the same with `ConfigModule` (videos 44–50).
- **What's next at scale:** Compose runs containers on **one** machine. Kubernetes (and similar) runs them across **many** machines, restarts them, and scales them. Same image and container ideas.

## 9. 🔗 Connects to

- [02 — Classes](02-js-classes-objects-this.md): image = class, container = instance
- [04 — Shared state](04-requests-shared-state-event-loop.md): disposable processes, state lives elsewhere
- Part B below: the `host`/`port`/`password` in `forRoot` are the door and key from section 4.7
- 14 — Configuration & Secrets: env vars, `.env`, not committing passwords
- 18 — Testing: throwaway test databases in Docker

## 10. ✍️ In my own words

> _(write here)_

## 11. 🛠️ Practice (Part A)

1. **Look inside.** `docker compose exec db bash`, then `cat /etc/os-release`, `ls /`, `ps aux`. Where are you? What can't you see? `exit` to leave.
2. **Lose data on purpose.** In `psql`: `create table test (id int); insert into test values (1);`. Then `docker compose down && docker compose up -d`. Is the table still there? Why?
3. **Keep data.** Switch to the recommended YAML (named volume), repeat step 2. Now what?
4. **The password trap.** With the volume in place, change `POSTGRES_PASSWORD` to `newpass`, run `docker compose up -d`, and try to log in from TablePlus with `newpass`. What happens and why?
5. **Two Postgres at once.** Add a second service `db2` on `'5433:5432'`. Connect to both. Are their tables shared?

<details><summary>Hints</summary>

- 1: You're in Debian, as root, and `ps` shows only Postgres processes: the process isolation from 4.1.
- 2: No named volume, so a new anonymous volume, so an empty database (4.6).
- 4: The entrypoint only uses the variable when the data folder is empty (4.5). Change it with SQL:
  `ALTER USER postgres PASSWORD 'newpass';`, or `down -v` to start over.
- 5: Two containers are two objects of the same class (section 5): separate data.

</details>

## 12. ❓ Quiz (Part A)

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

# Part B — TypeORM: entities & repositories (videos 23–25)

## 1. The problem

Postgres is running. Now `CoffeeService` has to talk to it. Without any library beyond the Postgres driver, the service looks like this:

```ts
async findById(id: number) {
  const { rows } = await pool.query('SELECT id, name, brand FROM coffee WHERE id = $1', [id]);
  if (!rows[0]) throw new NotFoundException(`Coffee #${id} not found`);
  return { id: rows[0].id, name: rows[0].name, brand: rows[0].brand };   // by hand, every time
}

async create(dto: CreateCoffeeDto) {
  const { rows } = await pool.query(
    'INSERT INTO coffee (name, brand) VALUES ($1, $2) RETURNING id, name, brand',
    [dto.name, dto.brand],
  );
  return rows[0];
}
```

It works. What's wrong with it shows up on the third table: every table needs the same five functions (find all, find one, insert, update, delete), each one a hand-written SQL string plus a hand-written row-to-object copy. `rows[0].name` is `any`, so a typo compiles. Rename a column and you grep for strings. And one forgotten `$1` placeholder, one `WHERE name = '${name}'` written in a hurry, and the client can run their own SQL on your database (that's **SQL injection**, section 3.1 shows it).

## 2. Mental model

If you wrote this by hand, without Nest or TypeORM, and did it properly, you'd write three lines:

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

Everything in Part B is those three lines. Line 1 is `TypeOrmModule.forRoot({...})` in `AppModule`. Line 2 is `TypeOrmModule.forFeature([Coffee])` in `CoffeeModule`. Line 3 is `@InjectRepository(Coffee)` in the service's constructor. The helper object from line 2, the bag of functions for one table, is what TypeORM calls a **repository**. The description of the table that lets TypeORM write those functions for you is a class with decorators, called an **entity**. The open connection from line 1 is the **DataSource**.

```
 class Coffee     ←→  table "coffee"          (the SHAPE: an entity)
 a Coffee object  ←→  one row
 coffee.name      ←→  column "name"
 coffeeRepository ←→  the WORKER for that table: find / save / delete   (a repository)
 db (DataSource)  ←→  the CONNECTION, opened once, shared by every worker
```

Frontend comparison: the repository is like a typed `fetch` wrapper for one resource (`userApi.getAll()`, `userApi.save()`), except it speaks SQL instead of HTTP. A library that keeps classes and tables in step like this is called an **ORM** (object-relational mapper).

## 3. Baby steps

### 3.1 Naive: SQL built from strings

The first version everybody writes, because it's the shortest:

```ts
async findByName(name: string) {
  const { rows } = await pool.query(`SELECT * FROM coffee WHERE name = '${name}'`);
  return rows;
}
```

Now a client calls `GET /coffee?name=x'; DROP TABLE coffee;--`. The string becomes:

```sql
SELECT * FROM coffee WHERE name = 'x'; DROP TABLE coffee;--'
```

Two statements. Postgres runs both. The table is gone. The input was never "data"; it was pasted into the code.

### 3.2 Better: parameters, and the driver keeps data separate from code

```ts
const { rows } = await pool.query('SELECT * FROM coffee WHERE name = $1', [name]);
```

`$1` is a slot. The SQL text travels to Postgres on its own, and the value travels separately, so `'; DROP TABLE coffee;--` is stored as a name and never runs. This is the one rule that never bends: **input goes in parameters, never in the SQL string.**

What's still wrong: everything from section 1. Five functions per table, hand-copied rows, `any` everywhere, and if you also open a fresh connection in every function (the tempting `const client = await connect()` at the top), each request pays the slow handshake with Postgres.

### 3.3 Better: open once, one helper per table, hand it over

The three lines from section 2, mapped onto the real code:

| Plain JS | This project | What it does |
|---|---|---|
| line 1: `const db = await connectToPostgres(...)` | `TypeOrmModule.forRoot({...})` in `src/app.module.ts:57-79` | **open the connection**, once, at startup |
| line 2: `const coffeeTable = { find, save }` | `TypeOrmModule.forFeature([Coffee, Flavor])` in `src/coffee/coffee.module.ts:23` | **make the helper for the coffee table** |
| line 3: `new CoffeeService(coffeeTable)` | `@InjectRepository(Coffee) private readonly coffeeRepositery: Repository<Coffee>` in `src/coffee/coffee.service.ts:43-49` | **hand that helper to the service** |

The repository **is** that helper: a bag of functions for one table (`find`, `findOne`, `save`, `update`, `delete`). TypeORM wrote those functions instead of you, and it knows the table is `coffee` with columns `name` and `brand` because it read the decorators on the `Coffee` class (3.4).

**Why is the connection opened separately from the helper?** Opening a connection to Postgres is slow, and you want one, shared. So it happens once in `AppModule`, and every table helper reuses it:

```
AppModule:     forRoot({...})        → ONE open connection
                     │
CoffeeModule:  forFeature([Coffee])  → coffee helper  ─► CoffeeService
UserModule:    forFeature([User])    → user helper    ─► UserService
```

**Why must you write `@InjectRepository(Coffee)` when the type already says `Repository<Coffee>`?** When TypeScript is compiled to JavaScript, `<Coffee>` is erased. The running code only sees "a repository", not which table. The decorator is you saying "the coffee one" in a way that survives compilation (section 4.2 shows what it expands to).

Need coffee data in another module? Put `forFeature([Coffee])` in that module too. Helpers are cheap; the connection stays shared.

Here's what the project printed when we logged what those two calls return (2026-09-22), to see that it isn't magic:

```
forRoot  → { module, imports }        imports = the piece that opens and holds the connection (marked global,
                                      which is why every module can reach it)
forFeature([Coffee]) → { module, providers, exports }
           providers = [ { provide: 'CoffeeRepository', inject: ['DataSource'] } ]
                       "make an object called CoffeeRepository, using the open connection"
```

Two names you'll keep seeing: **`forRoot` means "set this up once for the whole app"**, **`forFeature` means "set it up for this one feature folder"**. `ConfigModule`, `JwtModule` and `MongooseModule` use the same pair.

### 3.4 The class that describes the table

For TypeORM to write `find` and `save` for you, it needs to know what the table looks like. You tell it with a class where every property is a column, in `src/coffee/entity/coffee.entity.ts:35-49`:

```ts
@Entity()                        // "this class is a table" (default name: class name lowercased → "coffee")
export class Coffee {
  @PrimaryGeneratedColumn()      // integer primary key; Postgres generates it (a SEQUENCE)
  id: number;

  @Column()                      // type guessed from TS: string → varchar, NOT NULL by default
  name: string;

  @Column()
  brand: string;

  @Column({ type: 'json', nullable: true })   // explicit type; NULL allowed (this is how flavor started, before note 10)
  flavor?: string[];
}
```

Nobody wrote `CREATE TABLE`. With `synchronize: true` in `forRoot`, TypeORM compared this class with the database at startup and created the table. The real table Postgres made (`\d coffee`, 2026-09-22):

```
 id     | integer           | not null | default nextval('coffee_id_seq'::regclass)
 name   | character varying | not null |
 brand  | character varying | not null |
 flavor | json              |          |
 Indexes: PRIMARY KEY, btree (id)
```

The `@Column()` decorators are metadata (note 03): TypeORM reads them to know the table shape. They are a **different system** from class-validator's rules, which is why a DTO needs its own decorators (note 07 §6.1). A class like this, one per table, is what TypeORM calls an **entity**.

### 3.5 What each helper method really runs

`logging: true` in `forRoot` prints every query. Logged from this project's database (2026-09-22):

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
3. **`$1`, `$2` are parameters, not string concatenation.** Section 3.2's rule, applied by the library on every call. This is what prevents SQL injection, and it's why you never build SQL with template strings.

Which leaves `save()` against `update()` for changing a row:

| | `save(entity)` | `update(id, partial)` |
|---|---|---|
| Returns | the entity | `UpdateResult` |
| Loads the row first | yes (knows what changed) | no |
| Runs entity hooks / cascades to relations | yes | **no** |
| Good for | normal updates, relations (video 28) | bulk/simple column updates (`update({}, { recommendations: 0 })`) |

### 3.6 What a senior does: a pool, not one connection

One shared connection (line 1) beats one per request, but under load it's a queue: while one query waits on Postgres, every other request waits for the connection. So `forRoot` doesn't open one connection. It opens a **pool** (node-postgres defaults to 10) and lends connections out. Each query borrows one and gives it back:

```
 request A ┐
 request B ├─► pool [conn1..conn10] ─► Postgres
 request C ┘   (11th waits for a free one)
```

This is the note 04 event loop in action: `await repo.find()` releases the thread while Postgres works, so other requests keep being served. It also means **slow queries block the pool**, not only the client that asked: ten slow queries and the eleventh request, however cheap, waits (a **connection pool**).

## 4. How it works underneath

### 4.1 The whole chain, four links

```
 docker-compose.yaml      Postgres running on localhost:5432            (Part A)
        ▼
 TypeOrmModule.forRoot({...})   in src/app.module.ts:57
        → connects at startup, opens a POOL of connections
        → with synchronize:true, compares entities to tables and alters the DB
        ▼
 TypeOrmModule.forFeature([Coffee, Flavor])   in src/coffee/coffee.module.ts:23
        → registers a PROVIDER: "CoffeeRepository" = a Repository<Coffee>
        ▼
 constructor(@InjectRepository(Coffee) private readonly coffeeRepositery: Repository<Coffee>)
        → DI hands that provider to the service        src/coffee/coffee.service.ts:43-49   (note 03)
```

Break any link and you get a startup error. Forget `forFeature` and it's the familiar `Nest can't resolve dependencies of the CoffeeService (?)`.

### 4.2 The ~10 lines of JS behind `forFeature` and `@InjectRepository`

You might expect this to be enough:

```ts
constructor(private readonly repo: Repository<Coffee>) {}   // ❌
```

It isn't, because generics are erased at compile time. At runtime Nest only sees `Repository`, and can't tell `Repository<Coffee>` from `Repository<User>`. (Same reason an interface can't be injected, note 03 Q3.) So `forFeature([Coffee])` registers each repository under a **name**, and the decorator says which name to look up:

```ts
// what forFeature([Coffee]) roughly adds to the module's providers
{
  provide: getRepositoryToken(Coffee),     // the string "CoffeeRepository"
  useFactory: (dataSource) => dataSource.getRepository(Coffee),   // "using the open connection, build the coffee helper"
  inject: [DataSource],
}

// what @InjectRepository(Coffee) expands to
@Inject(getRepositoryToken(Coffee))        // "give me the provider registered under 'CoffeeRepository'"
```

And `dataSource.getRepository(Coffee)` is, in spirit, line 2 of section 2: read the decorators on `Coffee`, learn that the table is `coffee` with columns `id`, `name`, `brand`, and return an object whose `find` builds `SELECT ... FROM "coffee"` and whose `save` builds `INSERT INTO "coffee"(...) VALUES ($1, $2) RETURNING "id"`. That name a provider is registered under is what note 03 calls a **token**. `Repository<Coffee>` in the type position is then only for TypeScript: it makes `find()` return `Coffee[]` instead of `any[]`, and catches typos in `where: { ... }`.

### 4.3 One request, end to end

```
POST /coffee   { "name": "Latte", "brand": "Sbux" }
   │
   ▼  ValidationPipe (note 07): CreateCoffeeDto rules, src/coffee/dto/create-coffee.dto.ts
   │
   ▼
CoffeeController.create                     src/coffee/coffee.controller.ts:58
   │  this.coffeeService.create(dto)
   ▼
CoffeeService.create                        src/coffee/coffee.service.ts:205
   │  this.coffeeRepositery.create({...})   :233   → Coffee { name, brand }, id: undefined, NO SQL
   │  this.coffeeRepositery.save(entity)    :242
   ▼
Repository<Coffee>  →  borrows a connection from the pool (3.6)
   │  START TRANSACTION
   │  INSERT INTO "coffee"("name","brand","flavor") VALUES ($1,$2,$3) RETURNING "id"
   │  COMMIT
   ▼
localhost:5432 ── port mapping ──► container "db" ── Postgres writes the row, hands back id
   ▲
   │  entity with id  →  service returns it  →  controller returns it
   └──► TransformInterceptor (note 06)  →  201 { statusCode, data: { id, name, brand }, success }
```

## 5. Functional vs class

The entity, written without a class, would be a plain description of the table:

```js
// functional: a description TypeORM could read
const CoffeeTable = {
  name: 'coffee',
  columns: { id: { primary: true, generated: true }, name: 'varchar', brand: 'varchar' },
};
```

```ts
// class: what TypeORM asks for
@Entity()
export class Coffee {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @Column() brand: string;
}
```

What the class buys: the same file gives you the table description **and** the TypeScript type of a row, so `repo.find()` returns `Coffee[]` with no extra type to maintain, and rows come back as real instances (`instanceof Coffee`), which is what lets TypeORM run hooks and defaults on them. What it costs: decorators, one more metadata system to keep separate from class-validator's (note 07 §6.1), and the temptation to reuse the class as the API shape.

The repository, written without a class, is a closure over the connection:

```js
// functional: what a repository IS
function makeRepository(db, table) {
  return {
    find:    ()   => db.query(`SELECT * FROM "${table}"`),
    findOne: (id) => db.query(`SELECT * FROM "${table}" WHERE id = $1 LIMIT 1`, [id]).then((r) => r.rows[0] ?? null),
    save:    (row) => row.id ? update(db, table, row) : insert(db, table, row),
  };
}
const coffeeRepository = makeRepository(db, 'coffee');
```

```ts
// class: TypeORM's Repository<Coffee>, handed over by DI
constructor(@InjectRepository(Coffee) private readonly coffeeRepositery: Repository<Coffee>) {}
```

Functionally the connection is a closure variable; in the class it's a field set by the constructor and reached through `this`. What the class version buys is that DI can hand the helper over by token, so a unit test can hand over a fake with the same method names and never touch a database (note 03; course videos 66–68). What it costs is the token dance from 4.2, because the type alone doesn't survive to runtime.

## 6. In my project

| Where | What |
|---|---|
| `src/app.module.ts:57-79` | `TypeOrmModule.forRoot({ type: 'postgres', host: 'localhost', port: 5432, ..., autoLoadEntities: true, synchronize: true })` |
| `src/coffee/coffee.module.ts:23` | `TypeOrmModule.forFeature([Coffee, Flavor])` |
| `src/coffee/coffee.service.ts:43-49` | the constructor asking for both repositories with `@InjectRepository` |
| `src/coffee/coffee.service.ts:118-124` | `findOne({ where: { id } })` then `throw new NotFoundException` on `null` |
| `src/coffee/coffee.service.ts:153-161` | `preload({ ...dto, id })`, 404 on `undefined` |
| `src/coffee/coffee.service.ts:202` | `save(coffee)` after preload: returns the updated entity |
| `src/coffee/coffee.service.ts:233-242` | `create({...})` (memory only) then `save(entity)` (the INSERT) |
| `src/coffee/coffee.service.ts:141-145` | `find({ relations, skip, take })`: pagination (note 10 §5b) |
| `src/coffee/entity/coffee.entity.ts:35-49` | the `Coffee` entity: `@Entity`, `@PrimaryGeneratedColumn`, `@Column` |
| `src/coffee/entity/flavor.entity.ts:21-31` | the `Flavor` entity (note 10) |

The log line `TypeOrmModule dependencies initialized` at startup means `forRoot` connected. The `coffee` table appeared without any `CREATE TABLE` (the `\d coffee` output in 3.4).

`CoffeeService` is a textbook repository-backed service: `findAll`, `findById` (404 when missing), `create` (`create` + `save`), `deleteById`, `updateById` (`preload` + `save`).

Two things were wrong when this note was first written (2026-09-22), and both are practice tasks below:

- **`updateById` returned `UpdateResult`, not the coffee.** It did `preload(...)` (a SELECT) and then `update(id, coffee)`, so the client got `{"generatedMaps":[],"raw":[],"affected":1}`. The fix is `return this.coffeeRepositery.save(coffee)`: the row is already loaded, and `save` returns the updated entity (and handles relations, video 28). That's what `src/coffee/coffee.service.ts:202` does now.
- **`findAll()` had no pagination.** Fine with 3 rows, fatal with 3 million. It now takes `PaginationQueryDto` and passes `skip`/`take` (`src/coffee/coffee.service.ts:141-145`, video 29, note 10 §5b).

Two setup bugs from the same day, both about the shape/rules split: `CreateCoffeeDto extends PartialType(Coffee)` made every POST fail with **400 "property name should not exist"** (note 07 §6.1), and the generated coffee tests failed to start until they provided a fake repository under `getRepositoryToken(Coffee)` (practice task 5).

## 7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| `repo.create(dto)` and expect it saved | Nothing was written. `create` is memory-only; `save` writes | The client, who got a 201 with `id: undefined` and finds nothing on the next GET |
| `find()` with no `take`/`skip` on a growing table | One request pulls the whole table into RAM and can take the app down | Every user on that Node process, not only the one who asked (note 04) |
| `update()` when you need the updated entity or relation cascades | You get `UpdateResult`, and related rows aren't touched | The frontend, which needs a second request to show the new values; later, anyone whose flavors silently didn't save |
| Assume `findOne` throws when missing | It returns `null`, so the next line reads `null.name` and the client gets a 500 | Whoever asked for an id that doesn't exist, and whoever is on call reading the stack trace (your `findById` checks and throws 404 ✅) |
| Build SQL with template strings (`WHERE id = ${id}`) | SQL injection (3.1). Repositories and QueryBuilder parameterize for you | Everyone whose data is in that database |
| Return entities straight to the client forever | Internal columns (`passwordHash`, `ownerId`) leak. Map to a response shape (note 07 §6.1) | Every user whose row goes out |
| Loop `await repo.save(x)` over 1000 items | 1000 round trips. Pass an array: `repo.save(items)` (one batched call) | The client waiting on a 30 s request, and everyone sharing the pool with them |
| Leave `synchronize: true` outside local dev | It rewrites the schema to match entities: a rename can **drop a column with its data** (note 12: migrations) | Everyone, when production data disappears at deploy time |
| Forget `forFeature` in the feature module | `Nest can't resolve dependencies of the CoffeeService (?)` at startup | You, but at least loudly and before anyone else |

## 8. 🧠 Senior engineer lens

- **An ORM is a leaky abstraction.** It writes SQL for you, but you own the SQL. Keep `logging: true` on in dev, read the queries, and learn to spot `SELECT` with no `LIMIT`, missing indexes (note 12) and N+1 (note 10).
- **The repository is a seam.** Your service depends on "something with `find`/`save`", so unit tests inject a fake with `getRepositoryToken(Coffee)` and never touch a database (videos 66–68). That's DI paying off again (note 03).
- **The database is usually the bottleneck**, not Node. Pool size, slow queries and missing indexes decide your throughput long before your JS does.
- **Entity, API model and domain model are three things.** They start identical and drift. Keeping the DTO separate (note 07 §6.1) is what lets the DB change without breaking clients.
- **Anything that must happen together needs a transaction** (note 11). Two `save()` calls in a row are two independent writes: a crash in between leaves half-written data.

## 9. 🔗 Connects to

- [03 — DI](03-modules-controllers-providers-di.md): tokens, `useFactory`, why generics can't be injected
- [04 — Shared state & event loop](04-requests-shared-state-event-loop.md): pools, `await`, slow queries blocking everyone
- [07 — Pipes & Validation](07-pipes-validation.md) §6.1: DTO vs entity
- [10 — Relations](10-relations.md): flavors become rows, `relations: { flavor: true }`, pagination
- [11 — Transactions](11-transactions.md): what two `save()` calls don't give you; the pool from §3.6
- [12 — Indexes & Migrations](12-indexes-migrations.md): what replaces `synchronize: true`

## 10. ✍️ In my own words

> _(write here)_

## 11. 🛠️ Practice (Part B)

1. **See the SQL.** Add `logging: true` to `forRoot`, restart, and hit every coffee route. Match each request to its query in the 3.5 table.
2. **Fix `updateById`** so the API returns the updated coffee (one-line change, section 6). Confirm with Thunder Client. (The current code already has this fix; `git log -p src/coffee/coffee.service.ts` shows the before.)
3. **`create` without `save`.** Comment out the `save` line, POST a coffee, then `GET /coffee`. Where did it go?
4. **Paginate `findAll`**: accept `?limit=10&offset=0` and pass `{ take, skip }`. What SQL appears? (Compare with video 29. Also already in the code; read it and predict the SQL before you run it.)
5. **Unit-test the service with a fake repo**, no database:
   ```ts
   { provide: getRepositoryToken(Coffee), useValue: { find: jest.fn(), findOne: jest.fn() } }
   ```
   Test that `findById` throws `NotFoundException` when the fake returns `null`.

<details><summary>Hints</summary>

- 2: `preload` already ran the SELECT, so you hold a full entity. `save(coffee)` updates and returns it.
- 3: Look at the 3.5 table's first row before you run it.
- 4: `repo.find({ take: limit, skip: offset })` becomes `LIMIT`/`OFFSET` in the SQL.
- 5: `getRepositoryToken` comes from `@nestjs/typeorm`. Remember `import { jest } from '@jest/globals'` (our ESM setup).

</details>

## 12. ❓ Quiz (Part B)

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

**B.** Verified against our DB. `save(coffee)` returns the entity instead. Also `update()` skips cascades, which matters once coffees have flavors (video 28, note 10).

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
