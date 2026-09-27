# How to think before building

> The checklist a senior runs in their head before creating a single file. Worked through on a feature we
> already built (coffees + flavors), then on one we haven't (recommend a coffee, video 30), so you can see it
> applied twice.

## The difference between junior and senior isn't typing speed

A junior opens the editor and starts with whatever file the video started with.
A senior spends ten minutes with no editor open, and then types the same code, in a different order, with fewer
surprises. The ten minutes are these questions.

```
 1. What is the user actually trying to do?          → the story
 2. What data has to exist for that?                  → the nouns, and where they live
 3. What already exists in this codebase?             → don't build twice
 4. What's the flow of one request, end to end?       → the path through the layers
 5. Which piece has no dependencies?                  → build that first
 6. How will I know it works?                         → one command, decided before coding
 7. What could go wrong, and who pays?                → the traps, decided before they bite
```

## 1. The story, in one sentence, with a verb

Not "coffee module". Not "CRUD". A sentence a product person would say:

> "A visitor can see the coffees we sell, each with its flavors, and staff can add new ones."

That sentence already tells you: two kinds of user (visitor, staff → permissions later), a list (→ pagination),
"each with its flavors" (→ a relation), and "add" (→ validation on input).

If you can't write the sentence, you don't know what you're building yet. Stop and ask.

## 2. The data: nouns, and where each one lives

List the nouns in the story and, for each, decide **where it lives** and **how long**.

| Noun | Lives where | Lives how long | Why |
|---|---|---|---|
| coffee | database table | forever | it's the product |
| flavor | its own table | forever | shared by many coffees, stored once (note 10) |
| the link coffee↔flavor | a third table | forever | many on both sides (note 10 §2) |
| "page 3 of the list" | nowhere: it's in the request | one request | `?limit=10&offset=20` |
| the current user | nowhere yet | one request | from a token later; **never on a service field** (note 04) |

This table is where most design mistakes get caught. "Is `flavor` a column or a table?" is the whole difference
between the json blob we started with and the three-table version. Deciding it here costs a minute; deciding it
after data exists costs a migration (note 12).

Then draw the shape, however roughly:

```
 coffee ──< coffee_flavors >── flavor
 id, name, brand, recommendations     id, name
```

## 3. What already exists

Before creating anything, walk the tree once:

```
src/
  main.ts            ← global validation + response wrapper already applied to everything
  app.module.ts      ← the database connection is opened here; new modules get imported here
  common/dto/        ← PaginationQueryDto already exists: reuse, don't rewrite
  user/              ← a finished feature: copy its shape (module / controller / service / dto / entity)
  coffee/            ← where we're working
  utils/             ← TransformInterceptor: every response is already wrapped
```

Three things this tells you before you write a line: validation is already global (so a DTO is enough),
responses are already wrapped (so don't wrap again in the controller), and there's a pagination DTO to reuse.

## 4. The flow of one request, end to end

Pick the most important request and trace it through the Big Map (`notes/README.md`) **before** coding.
For "staff adds a coffee":

```
 POST /coffee  { name, brand, flavor: ["vanilla"] }
   │
   ▼ main.ts        ValidationPipe: body checked against CreateCoffeeDto (400 if wrong)      ← DTO needed
   ▼ controller     @Post() create(@Body() dto) → hands it to the service                     ← thin
   ▼ service        words → flavor rows (findOrCreateFlavor), then create + save              ← the real work
   ▼ repository     INSERT coffee, INSERT missing flavors, INSERT link rows (cascade)          ← TypeORM
   ▼ Postgres       three tables touched, one transaction (save does that for you here)
   ▲ interceptor    { statusCode: 201, data: {...}, success: true }
```

Every arrow is a file. Every "←" is a decision you've now made on purpose instead of by accident.

## 5. What to create first: the thing with no dependencies

Look at what depends on what:

```
 Flavor entity  ──►  Coffee entity  ──►  CoffeeService  ──►  CoffeeController
                          │                    ▲
                          └── forFeature ──► CoffeeModule ──► AppModule
                                                ▲
 CreateCoffeeDto ───────────────────────────────┘ (controller uses it)
```

**Build from the leaf inward, and make the app start after each step:**

| Step | Create | Why now | It works when |
|---|---|---|---|
| 1 | `flavor.entity.ts`, `coffee.entity.ts` | nothing depends on anything else yet; the table shape is the biggest decision | app starts, `\dt` shows three tables |
| 2 | `coffee.module.ts` with `forFeature([Coffee, Flavor])`, imported in `AppModule` | wires the tables in; without this nothing can be injected | app starts, no "can't resolve dependencies" |
| 3 | `coffee.service.ts` with `findAll` only | smallest useful behavior; proves the repository works | a scratch call or a temporary route returns `[]` |
| 4 | `coffee.controller.ts` with `GET /coffee` | now there's an HTTP door to what already works | `curl localhost:3000/coffee` → `[]` |
| 5 | `create-coffee.dto.ts` + `POST /coffee` | input needs rules before it's accepted | `curl -X POST` → 201, then `GET` shows it |
| 6 | flavors translation, `PATCH`, `DELETE`, pagination | one at a time, each verified | each has its own curl |

The rule underneath: **never have more than one thing broken at a time.** If you write entity + service +
controller + DTO in one go and the app doesn't start, you have four suspects. One step at a time, one suspect.

(The video did it in a different order because it's a video. That's fine to follow along; this is how you'd do it
on your own.)

## 6. How will I know it works? Decide before coding

For each step, one command you'll run. If you can't say what "works" looks like, you're not ready to code it.

```bash
docker compose exec db psql -U postgres -c "\dt"                  # step 1: three tables
curl -s localhost:3000/coffee                                     # step 4: []
curl -s -X POST localhost:3000/coffee -H 'Content-Type: application/json' \
  -d '{"name":"Latte","brand":"Sbux","flavor":["vanilla"]}'       # step 5: 201 with an id
docker compose exec db psql -U postgres -c "select * from coffee_flavors;"   # links exist
```

Frontend link: you already do this with a component. You know what it should render before you write it.

## 7. What could go wrong, and who pays

Write the traps down **before** they happen. From this feature:

| Trap | Who pays | Decided how |
|---|---|---|
| client sends `isAdmin: true` | every user, if it's saved | `whitelist` + explicit fields (note 07) |
| client sends `"flavor": "vanilla"` (not a list) | the on-call engineer, at 3am, with a 500 | `@IsArray()` |
| `GET /coffee` with 2 million rows | every user at once (one thread) | pagination with a max (note 10 §5b) |
| two staff add the same flavor at the same moment | data: duplicate "vanilla" rows | unique index on `flavor.name` (note 12) |
| rename a column later | everyone, if data is dropped | migrations, never `synchronize` in prod |

You won't think of everything. You'll think of more than zero, which is the point.

---

## Second pass: a feature we haven't built (video 30, "recommend a coffee")

Ten minutes, no editor. Watch the same questions produce the plan.

**1. Story:** "A user recommends a coffee; the count goes up, and we keep a record of the event for analytics."

**2. Nouns:**

| Noun | Lives where | Note |
|---|---|---|
| recommendations count | a column on `coffee`, default 0 | it's a fact about the coffee |
| the event | a new `event` table: `id, type, name, payload` | analytics reads it later; it's its own thing |
| who recommended | nowhere yet (no auth) | put `coffeeId` in the payload for now; `userId` once we have tokens |

**3. Exists already:** `coffee` entity and service, the database connection, `forFeature` in `CoffeeModule`.
So: no new module (the video says the same), add `Event` to the existing `forFeature`.

**4. Flow:**
```
 POST /coffee/:id/recommend
   ▼ ParseIntPipe on :id
   ▼ controller → service.recommendCoffee(id)
   ▼ service: load coffee (404 if missing) → BEGIN → count + 1 → insert event → COMMIT   ← note 11
   ▲ interceptor wraps the updated coffee
```
The word "and" in the story ("count goes up **and** we keep a record") is the signal for a transaction.

**5. Order:** `Event` entity → `recommendations` column → app restarts and both tables change (verify with `\d`)
→ `recommendCoffee` in the service using `DataSource` → route → curl.

**6. Verify:** `curl -X POST .../coffee/1/recommend` twice → count 2, two event rows. Then throw on purpose
between the two writes and check that **neither** landed.

**7. Traps:** two users at once → lost update unless the database does the arithmetic (note 11 §4);
forgetting `release()` → pool leak; recommending a missing coffee → 404, not 500.

That plan took longer to read than it takes to think, once it's a habit. Then you open the editor.

## The same idea, at every size

| Size | The questions look like |
|---|---|
| one function | what goes in, what comes out, what's the bad input |
| one feature (this note) | story, data, existing code, flow, order, verify, traps |
| a system (Day 18) | who calls what, what's stored where, what fails first under load, what's the blast radius |

It's one habit. It only gets bigger.
