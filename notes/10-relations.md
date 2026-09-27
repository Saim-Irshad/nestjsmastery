# 10 — Relations: when one thing belongs to another

> 📍 **Where on the Big Map:** still the database layer, below the service. The service asks the repository as before; the repository now walks across three tables instead of one.
> 📘 **Official course:** video 26 Relations · video 27 Fetching them · video 28 Cascade · video 29 Pagination
> 🌿 Branch: `relations`

## 1. The problem

A coffee tastes of vanilla and nutty. Cappuccino also tastes of vanilla. Write that down:

```
Latte      → vanilla, nutty
Cappuccino → vanilla
```

Read it from both ends. A coffee has several flavors, **and** a flavor is used by several coffees. Several on both sides.

Before this lesson, the coffee row carried its flavors as a list inside one box. This is what `coffee.entity.ts` looked like:

```ts
// coffee.entity.ts, before video 26
@Column({ type: 'json' })
flavor?: string[];          // ["vanilla", "nutty"] lives inside the coffee row
```

```
coffee
 id | name        | flavor
 1  | Latte       | ["vanilla","nutty"]
 2  | Cappuccino  | ["vanilla"]
```

Showing one coffee works fine with this, which is why it felt OK. It stops working the moment you ask the database a question that crosses coffees:

- **"Which coffees have vanilla?"** There is no column to compare against. The database has to open every JSON box, one at a time, and look inside.
- **"Rename vanilla to French Vanilla everywhere."** The word lives in every coffee that has it, so you rewrite thousands of boxes and hope you found them all.
- **"How many flavors do we sell?"** Nobody knows. There is no list of flavors anywhere, only copies of a word scattered across rows.
- **Nothing stops `["vanila"]` or `["banana"]`**, because there is no list of real flavors to check against. A typo becomes a new flavor.

The rest of this note is about the shape that fixes this, why every relational database uses that shape, and what it costs to read it back.

## 2. Mental model

Keep the two lists clean and write the **connections** down separately, one line per connection:

```
coffee                    coffee_flavors             flavor
 id | name                 coffeeId | flavorId        id | name
 1  | Latte        ──┐        1     |    3    ┌──►    3  | vanilla
 2  | Cappuccino    │         1     |    5    │       5  | nutty
                    └──►      2     |    3    ┘
```

Read the middle table out loud: *"coffee 1 goes with flavor 3. Coffee 1 goes with flavor 5. Coffee 2 goes with flavor 3."* The word "vanilla" exists **once**, on the right. Everything else points at it.

If you have ever normalised state on the frontend, you have done this by hand: instead of nesting a copy of each flavor object inside every coffee object, you keep `flavorsById` in one place and let each coffee hold a list of ids. Same instinct. The difference is that here the database enforces it: it will refuse an id that points at nothing, and it will refuse the same pair twice.

## 3. Baby steps

The shape above is not obvious the first time, so it is worth walking through the three ways that don't work. Each one is something people actually ship.

### 3.1 Try 1 — a flavor column on coffee

```
coffee
 id | name  | flavorId
 1  | Latte | 3          ← only vanilla. Where does nutty go?
```

One box holds one value. Latte needs two, so you add `flavorId2`, then `flavorId3`, and then someone wants four. Every new flavor is a schema change, and "which coffees have vanilla?" has to check every one of those columns. Dead end.

### 3.2 Try 2 — a coffee column on flavor

```
flavor
 id | name    | coffeeId
 1  | vanilla | 1          ← Latte's vanilla
 2  | vanilla | 2          ← Cappuccino's vanilla, a SECOND copy of the word
```

Now the word gets copied once per coffee. Fix a typo in row 1 and row 2 stays wrong. "How many flavors do we sell?" counts vanilla twice. Dead end, and a quieter one than Try 1, because it looks fine for a while.

### 3.3 Try 3 — a list inside one box (what we had)

This is the `flavor json` column from section 1. It's the same problem as Try 2 wearing a different coat: the word is still copied into every coffee, and on top of that the database can't see inside the box, so it can't compare, count or check anything about the words.

What all three tries have in common: they try to fit "several on both sides" into two tables, and a table is a grid where every box holds exactly one value. The pain is the shape fighting back.

### 3.4 Better — a third table of pairs, written by hand

Stop trying to fit the connections into either table and give them their own. This is plain SQL you could type into `psql` yourself:

```sql
CREATE TABLE flavor (
  id   serial PRIMARY KEY,
  name varchar NOT NULL
);

CREATE TABLE coffee_flavors (
  "coffeeId" integer NOT NULL REFERENCES coffee(id),   -- must point at a real coffee
  "flavorId" integer NOT NULL REFERENCES flavor(id),   -- must point at a real flavor
  PRIMARY KEY ("coffeeId", "flavorId")                 -- the same pair can't appear twice
);
```

Now look at what each of the earlier questions costs:

- Latte has two flavors → two rows in the middle table. A third flavor is one more row; no column ever changes.
- Vanilla belongs to two coffees → two rows. The word itself is stored once.
- "Rename vanilla" → one `UPDATE` on one row in `flavor`, and every coffee shows the new name.
- "Which coffees have vanilla?" → follow the pairs. The database is built for exactly that.

And the two `REFERENCES` lines give you something the JSON list never could. I tried to link a coffee to a flavor that doesn't exist, in our own database (2026-09-25):

```
postgres=# insert into coffee_flavors ("coffeeId","flavorId") values (1, 999);
ERROR:  insert or update on table "coffee_flavors" violates foreign key constraint "FK_1261799af4d50c583a441518d05"
DETAIL:  Key (flavorId)=(999) is not present in table "flavor".
```

The database refused, on its own, before any of our code got a say. A bug, a script, a teammate's late-night console session: none of them can create a link to nothing.

**What's still wrong with this version:** the shape is right, but you are now doing all the plumbing by hand. Creating one coffee means an `INSERT` into `coffee`, an `INSERT` into `flavor` for any new word, and one `INSERT` per pair into `coffee_flavors`. Reading a coffee back means pulling rows from three tables and stitching them into one object. And the client still sends words (`"vanilla"`), while the tables want ids. Every service method grows a pile of SQL and a pile of glue.

### 3.5 What a senior does — describe the shape once, let the ORM do the plumbing, and stay in charge of fetching

**Describe the shape in the entities.** Two lines on each side say "many on both ends", and one of them says "the link table belongs to me":

```ts
// src/coffee/entity/coffee.entity.ts
@JoinTable({ name: 'coffee_flavors' })
@ManyToMany((type) => Flavor, (flavor) => flavor.coffee, { cascade: true })
flavor?: Flavor[];

// src/coffee/entity/flavor.entity.ts
@ManyToMany((type) => Coffee, (coffee) => coffee.flavor)
coffee: Coffee[];
```

| Piece | What it means |
|---|---|
| `@ManyToMany` on both sides | "many on both ends", so TypeORM builds the third table for you |
| `@JoinTable()` on **one** side | that side owns the link table. Leave the `name` option out and TypeORM invents one from the pieces: `coffee_flavor_flavor` (entity + property + entity) |
| `(type) => Flavor` | the two files import each other, so when one file is still loading the other's class isn't ready yet. Handing over a function delays the lookup until both exist |
| `(flavor) => flavor.coffee` | which property on the other side points back here |
| `{ cascade: true }` | when a coffee is saved, also insert any brand-new flavor rows attached to it |
| `flavor?: Flavor[]` | this property now holds rows (`{ id, name }`), not words |

Because `synchronize: true` is on in `app.module.ts`, restarting the app created `flavor` and `coffee_flavors`, and **dropped the old json column with everything in it**. Fine on a laptop with three test coffees. In video 32 this turns into migration files (note 12, Part B), because on a real server that column is customer data.

**Translate words into rows in the service.** The client still sends `["vanilla", "nutty"]`, and it should: clients know words, not our internal ids. So the service has one small helper whose whole job is "one word → one flavor row":

```ts
// src/coffee/coffee.service.ts
private async findOrCreateFlavor(name: string): Promise<Flavor> {
  const existingFlavor = await this.flavorRepositery.findOne({ where: { name } });
  if (existingFlavor) return existingFlavor;        // reuse the shared row
  return this.flavorRepositery.create({ name });    // memory only; cascade saves it
}
```

Used like this when creating a coffee:

```ts
const flavors = await Promise.all(
  (createCoffeeDto.flavor ?? []).map((name) => this.findOrCreateFlavor(name)),
);
const coffeeEntity = this.coffeeRepositery.create({ ...createCoffeeDto, flavor: flavors });
return await this.coffeeRepositery.save(coffeeEntity);
```

**Why `Promise.all`?** `.map` with an async function does not give you flavors. It gives you a list of unfinished database trips: `["vanilla","nutty"] → [Promise, Promise]`. `Promise.all` waits for all of them and hands back the results in order. The tempting alternative is a loop with `await` inside, and the difference matters:

```
await in a loop:   vanilla ─5ms─► nutty ─5ms─► caramel ─5ms─►   = 15ms
Promise.all:       all three at once                            = 5ms
```

Harmless with 3 items, painful with 50. **"`await` inside a loop" is one of the most common causes of slow endpoints.** And if any single lookup fails, `Promise.all` throws, so you never save a coffee with half its flavors.

**Keep the three update cases apart.** On a `PATCH`, "the client didn't mention flavors" and "the client sent an empty list" mean different things:

| Client sends | We pass to `preload` | Meaning |
|---|---|---|
| nothing | `undefined` | leave the coffee's flavors alone |
| `[]` | `[]` | remove all its flavors |
| `["vanilla"]` | `[row]` | replace them with this list |

**Fetch relations on purpose, not by default.** Relations are **not** loaded unless you ask:

```ts
this.coffeeRepositery.find();                                // coffees only, no flavor field at all
this.coffeeRepositery.find({ relations: { flavor: true } }); // coffees + their flavors
```

Why isn't it automatic? Because it stops being one simple `SELECT`. The database has to walk coffee → coffee_flavors → flavor and stitch the rows back together, and that costs time. Section 4 shows the exact SQL. You ask for it where you need it.

⚠️ **The mistake this opt-in design is protecting you from:** fetching 100 coffees, then looping and fetching each coffee's flavors inside the loop. That is 1 + 100 round trips to the database. I did it on purpose against our four coffees with `logging: true` (2026-09-25): one `SELECT` for the coffees, then four more, one per coffee, each with the same shape and a different parameter. Five queries for four rows; with 10,000 rows it would be 10,001. Asking for the relation up front is one query. When an endpoint is mysteriously slow, this is the first thing to look for. (The pattern has a name: **N+1 queries**.)

**The names, now that you've seen all of it.** A link where several rows on each side point at several rows on the other is a **many-to-many** relation. The table of pairs in the middle is called a **join table**, **link table** or **pivot table**. Each `REFERENCES` rule is a **foreign key**: "this number must match a real id in that other table". The rule that the pair can't repeat is a **primary key** on the two columns together. None of this is a Nest or TypeORM idea. Every relational database solves "many on both sides" this way, and every ORM in every language generates the same three tables.

For completeness, the two other shapes you'll meet. Only many-to-many needs the extra table:

- **one-to-many** (a user has many orders): no third table. The `orders` table gets a `userId` column, because each order belongs to exactly one user, so one box is enough.
- **one-to-one** (a user has one profile): a `profileId` column on one of the two tables.

## 4. How it works underneath

### 4.1 What the decorators do at startup

A decorator is a function that runs once when the class is defined and sticks a note on it (note 03). `@ManyToMany` and `@JoinTable` do nothing more than record a description of the link, roughly this:

```js
// what TypeORM is roughly doing when coffee.entity.ts loads
relations.push({
  from: Coffee, property: 'flavor',
  to: () => Flavor,                        // a function, because Flavor may not exist yet
  inverse: (flavor) => flavor.coffee,
  kind: 'many-to-many',
  owner: true,                             // @JoinTable was on this side
  joinTable: 'coffee_flavors',
  cascade: true,
});
```

When the app starts with `synchronize: true`, TypeORM reads those notes and turns them into `CREATE TABLE` statements. This is what it built in our database. I asked Postgres to describe the link table (2026-09-25):

```
postgres=# \d coffee_flavors
            Table "public.coffee_flavors"
  Column  |  Type   | Collation | Nullable | Default
----------+---------+-----------+----------+---------
 coffeeId | integer |           | not null |
 flavorId | integer |           | not null |
Indexes:
    "PK_cf9835ad2a5149c5d780194e556" PRIMARY KEY, btree ("coffeeId", "flavorId")
    "IDX_1261799af4d50c583a441518d0" btree ("flavorId")
    "IDX_e02a91775041bbe3bd6638e4d5" btree ("coffeeId")
Foreign-key constraints:
    "FK_1261799af4d50c583a441518d05" FOREIGN KEY ("flavorId") REFERENCES flavor(id) ON UPDATE CASCADE ON DELETE CASCADE
    "FK_e02a91775041bbe3bd6638e4d56" FOREIGN KEY ("coffeeId") REFERENCES coffee(id) ON UPDATE CASCADE ON DELETE CASCADE
```

Line by line, that is section 3.4's hand-written table, plus three things TypeORM chose for us:

- the primary key on the **pair**, so the same link can't be stored twice;
- an index on each id column, so following the pairs in either direction is a lookup rather than a scan (note 12, Part A);
- `ON DELETE CASCADE` on both foreign keys. Delete a coffee and its rows in `coffee_flavors` disappear with it; the flavor rows stay, because other coffees may share them. This is TypeORM's default for a join table, and it is worth knowing, because a foreign key can also be set to **refuse** the delete instead. Which one you want is a decision, not a default.

### 4.2 What `find({ relations })` runs, and how the rows come back

With `logging: true`, `find({ relations: { flavor: true } })` produced this single statement against our database (2026-09-25; aliases shortened for reading, otherwise as logged):

```sql
SELECT "Coffee"."id", "Coffee"."name", "Coffee"."brand",
       "Coffee__Coffee_flavor"."id", "Coffee__Coffee_flavor"."name"
FROM "coffee" "Coffee"
LEFT JOIN "coffee_flavors" "Coffee_Coffee__Coffee_flavor"
       ON "Coffee_Coffee__Coffee_flavor"."coffeeId" = "Coffee"."id"
LEFT JOIN "flavor" "Coffee__Coffee_flavor"
       ON "Coffee__Coffee_flavor"."id" = "Coffee_Coffee__Coffee_flavor"."flavorId"
```

Two `LEFT JOIN`s: coffee → pairs → flavor. `LEFT` means "keep the coffee even if it has no pairs", which is why a coffee with no flavors comes back with `flavor: []` instead of vanishing.

The database does not return nested objects. It returns **flat rows, one per coffee-flavor pair**:

```
 Coffee_id | Coffee_name | flavor_id | flavor_name
 1         | Latte       | 3         | vanilla
 1         | Latte       | 5         | nutty        ← Latte appears twice
 2         | Cappuccino  | 3         | vanilla
```

TypeORM then folds those rows into the objects you get. Written by hand, the folding is a `reduce` you have written a hundred times:

```js
const byId = new Map();
for (const row of rows) {
  if (!byId.has(row.Coffee_id)) {
    byId.set(row.Coffee_id, { id: row.Coffee_id, name: row.Coffee_name, flavor: [] });
  }
  if (row.flavor_id !== null) {
    byId.get(row.Coffee_id).flavor.push({ id: row.flavor_id, name: row.flavor_name });
  }
}
const coffees = [...byId.values()];
```

That folding is the "stitching" cost from section 3.5, and it is why a list with relations pulls more rows than it looks: 100 coffees with 5 flavors each is 500 rows over the wire, not 100. (That's what the technical word **join** refers to: the database walking from one table to another through matching ids.)

### 4.3 What `save()` with `cascade: true` runs

I saved a coffee with one existing flavor (`vanilla`, already row 1) and one brand-new one (`nutty`), inside a transaction that I rolled back afterwards so nothing stayed in the database. The log (2026-09-25):

```
query: START TRANSACTION
query: INSERT INTO "coffee"("name", "brand") VALUES ($1, $2) RETURNING "id"       -- ["Mocha","demo"]
query: INSERT INTO "flavor"("name") VALUES ($1) RETURNING "id"                    -- ["nutty"]
query: INSERT INTO "coffee_flavors"("coffeeId", "flavorId") VALUES ($1, $2), ($3, $4)  -- [6,1,6,2]
saved: {"id":6,"name":"Mocha","brand":"demo","flavor":[{"id":1,"name":"vanilla"},{"id":2,"name":"nutty"}]}
```

Read what happened: the coffee was inserted and got id 6; `nutty` had no id, so `cascade` inserted it and got id 2; `vanilla` already had id 1, so it was left alone; then both pairs went into the link table in one statement. All of it inside one transaction, so a failure anywhere leaves nothing behind (note 11). Without `cascade: true`, TypeORM would have tried to write the pair `(6, undefined)` for `nutty` and the save would fail, because you're attaching a flavor row that was never inserted.

### 4.4 The whole flow for `POST /coffee`

```
 client  POST /coffee  { name, brand, flavor: ["vanilla","nutty"] }
   │
   ▼
 main.ts            ValidationPipe: body → CreateCoffeeDto, @IsArray/@IsString({each}) checked
   │
   ▼
 coffee.controller.ts:58   create(@Body() dto)  →  coffeeService.create(dto)
   │
   ▼
 coffee.service.ts:188     Promise.all( dto.flavor.map(findOrCreateFlavor) )
   │                         ├─ SELECT ... FROM "flavor" WHERE name = $1   ["vanilla"] → row 1
   │                         └─ SELECT ... FROM "flavor" WHERE name = $1   ["nutty"]   → null → create({name}) in memory
   ▼
 coffee.service.ts:199     coffeeRepositery.create({ ...dto, flavor: [row1, memoryNutty] })   (no SQL)
   │
   ▼
 coffee.service.ts:208     coffeeRepositery.save(coffee)
   │                         START TRANSACTION
   │                         INSERT INTO "coffee" ...            RETURNING id → 6
   │                         INSERT INTO "flavor" ("nutty")      RETURNING id → 2      ← cascade
   │                         INSERT INTO "coffee_flavors" (6,1),(6,2)
   │                         COMMIT
   ▼
 response  201  { id: 6, name, brand, flavor: [{id:1,...},{id:2,...}] }
```

Notice where the network trips are: two `SELECT`s for the lookups (in parallel), then one transaction with three `INSERT`s. Five statements for one coffee with two flavors. That is the price of the clean shape, and it is a price worth paying once, at write time, so that every later read and rename is cheap.

## 5. Functional vs class

Two classes are involved here, and they play different roles.

**The entities are classes that describe tables.** Written as plain data, the same description would be an object:

```js
// functional / plain-data version of coffee.entity.ts
const CoffeeTable = {
  name: 'coffee',
  columns: { id: 'serial primary key', name: 'varchar', brand: 'varchar' },
  relations: {
    flavor: { kind: 'many-to-many', to: 'flavor', through: 'coffee_flavors', cascade: true },
  },
};
```

That works, and some ORMs do exactly this. What the class version buys: the **same name** does two jobs. `Coffee` is the description TypeORM reads at startup, *and* the type of every row it hands back, so `coffee.flavor[0].name` is checked by TypeScript and `row instanceof Coffee` is true. The decorators need a class to hang their notes on. What it costs: the two entity files import each other, so you get the `(type) => Flavor` dance to break the cycle, and a property like `flavor?: Flavor[]` looks like a normal field but is really a promise TypeORM only keeps when you ask with `relations`.

**The service is a class holding the table helpers.** As a factory function with closures it would be:

```js
// functional version of the relevant part of CoffeeService
function makeCoffeeService(coffeeTable, flavorTable) {
  async function findOrCreateFlavor(name) {
    const existing = await flavorTable.findOne({ where: { name } });
    return existing ?? flavorTable.create({ name });
  }
  return {
    async create(dto) {
      const flavors = await Promise.all((dto.flavor ?? []).map(findOrCreateFlavor));
      return coffeeTable.save(coffeeTable.create({ ...dto, flavor: flavors }));
    },
  };
}
```

`findOrCreateFlavor` is a closure variable here; in the class it is a `private` method. `coffeeTable` and `flavorTable` are captured arguments; in the class they are `private readonly` constructor fields, and `this.coffeeRepositery` is "the field on the object before the dot". Same logic, same number of lines.

What the class buys is the part that isn't visible in the file: Nest builds the object for you and fills the constructor from `forFeature([Coffee, Flavor])` (note 03). With the factory function, you'd be the one calling `makeCoffeeService(coffeeRepo, flavorRepo)` somewhere, and wiring it into the controller by hand. Pick the class inside Nest because the framework's wiring assumes it; pick the factory in a script or a test where you're happy to wire things yourself.

## 5b. Pagination (video 29)

`find()` with nothing else means **"give me every row"**. That is a naive version of a list endpoint, and it is what `GET /coffee` did until this video:

```ts
findAll() {
  return this.coffeeRepositery.find({ relations: { flavor: true } });   // every coffee, every flavor
}
```

**What breaks:** with 20 rows in dev, nothing. With 2 million rows in production, one request loads them all into memory, builds 2 million objects (and, with relations, many more rows than that, see section 4.2), and because one thread serves everyone (note 04), **every other user waits** while it does.

**Better: let the client ask for a slice.** List endpoints take two numbers:

```
GET /coffee?limit=10&offset=0    → rows 1–10
GET /coffee?limit=10&offset=10   → rows 11–20
```

```ts
// src/common/dto/pagination-query.dto.ts   ← common/, because it isn't about coffee
export class PaginationQueryDto {
  @IsPositive() @IsOptional() @Type(() => Number) offset: number;
  @IsPositive() @IsOptional() @Type(() => Number) limit: number;
}

// src/coffee/coffee.controller.ts: @Query() with no name = the whole query string as one object
findAll(@Query() paginationQuery: PaginationQueryDto) { ... }

// src/coffee/coffee.service.ts
this.coffeeRepositery.find({ skip: paginationQuery.offset, take: paginationQuery.limit });
//                            ↑ SQL OFFSET              ↑ SQL LIMIT
```

With `logging: true`, `find({ skip: 2, take: 2 })` ran exactly what you'd expect (2026-09-25):

```sql
SELECT "Coffee"."id", "Coffee"."name", "Coffee"."brand" FROM "coffee" "Coffee" LIMIT 2 OFFSET 2
```

**Everything in a URL is text.** `?limit=10` arrives as the string `"10"`. `@Type(() => Number)` converts it first, then the rules run; it works because `transform: true` is on in `main.ts`. Without the conversion, `@IsPositive()` would be checking a string and rejecting it.

**What's still wrong with our version, two holes:**

1. `@IsPositive()` means "greater than 0", so **`?offset=0` is rejected** with a 400. Offset 0 is the first page and the most common value. Use `@Min(0)` for offset; keep `@IsPositive()` (or `@Min(1)`) for limit.
2. **Nothing caps `limit`.** `?limit=1000000` undoes the whole point. And if the client sends neither number, both are `undefined` and we're back to "the entire table". Real APIs cap it (`@Max(100)`) and apply a default when nothing is sent, so "no parameters" never means "everything".

**What a senior knows about offset** (worth having before you ever need it): to skip 100,000 rows the database still walks past them, so page 5,000 is much slower than page 1. And if someone inserts a row while a user is paging, everything shifts and an item can appear twice or be skipped. Feeds and infinite scroll use a different question instead: "give me the 20 after id X". That stays fast at any depth and doesn't shift when rows are inserted (the name for it is **cursor paging**). Offset paging is fine for admin tables with page numbers; it's the wrong tool for a feed.

## 6. In my project

| What | Where |
|---|---|
| The owning side of the relation, with `@JoinTable` and `cascade: true` | `src/coffee/entity/coffee.entity.ts:85-87` |
| The other side, no `@JoinTable` | `src/coffee/entity/flavor.entity.ts:46-47` |
| `@PrimaryGeneratedColumn()` on `Flavor` (it was `@PrimaryColumn()` first, see section 7) | `src/coffee/entity/flavor.entity.ts:27-28` |
| Both entities registered so both repositories exist | `src/coffee/coffee.module.ts:23` |
| The translator, `findOrCreateFlavor` | `src/coffee/coffee.service.ts:68-81` |
| `Promise.all` over the words, then `create` + `save` | `src/coffee/coffee.service.ts:188-208` |
| The three update cases and `preload` | `src/coffee/coffee.service.ts:145-157` |
| `relations: { flavor: true }` plus `skip`/`take` | `src/coffee/coffee.service.ts:107-111` |
| The DTO keeps `flavor?: string[]` (words, not ids) | `src/coffee/dto/create-coffee.dto.ts:42-45` |
| `PaginationQueryDto` (with the two holes still open) | `src/common/dto/pagination-query.dto.ts:30-38` |
| `@Query()` handing the whole query string to the DTO | `src/coffee/coffee.controller.ts:39-42` |
| `transform: true`, which makes `@Type(() => Number)` work | `src/main.ts:55-59` |
| `synchronize: true`, which built (and dropped) the tables | `src/app.module.ts:78` |

What the database holds right now (2026-09-25):

```
postgres=# select * from coffee order by id;   select * from flavor;   select * from coffee_flavors;
 id |    name     |  brand              id |  name              coffeeId | flavorId
----+-------------+---------           ----+---------          ----------+----------
  1 | vanilla3333 | vanilla              1 | vanilla                   5 |        1
  3 | vanilla1    | vanilla
  4 | vanilla2    | vanilla
  5 | latte       | nest
```

One flavor row, one link row: coffee 5 goes with flavor 1. Coffees 1, 3 and 4 have no links, so with `relations: { flavor: true }` they come back with `flavor: []` and coffee 5 comes back as:

```json
{"id":5,"name":"latte","brand":"nest","flavor":[{"id":1,"name":"vanilla"}]}
```

The query behind that and the query count for the N+1 experiment are in section 4.

## 7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| Keep a list of words in a json column | Can't search, can't rename in one place, nothing checks the words are real | Whoever writes the first report or search feature; the data team, months later |
| Copy the word into every child row | Duplicates drift apart; counts and renames become impossible | Users who see "vanilla" and "Vanilla" as two flavors; you, doing a cleanup script at midnight |
| `@JoinTable()` on both sides | Two link tables, or a startup error. One owner only | Everyone, because the app won't start or writes go into the wrong table |
| Expect `coffee.flavor` without asking for it | It is `undefined`; you didn't ask, so it wasn't fetched | The frontend, which renders nothing and files a bug against the API |
| Fetch a list, then query each item's relations in a loop | N+1 queries: 1 + one per row. Fine with 4 rows (5 queries, measured), a disaster with 10,000 | Every user of that endpoint, and every other user waiting on the shared pool (note 09 §3.6) |
| `@PrimaryColumn()` when you don't supply ids | We hit this: the service creates flavors from a name alone and has no id to give, so inserts fail. `@PrimaryGeneratedColumn()` lets Postgres number them | You, at the terminal, reading a wall of TypeScript errors |
| Put database ids in the request DTO | Clients would have to know internal ids. Let them send words; translate on the server | Every client developer, and you when ids change |
| Leave `cascade: true` on everywhere | Convenient for flavors; dangerous when saving one thing quietly rewrites a tree of related rows. Turn it on where you mean it | The person whose unrelated rows got overwritten by a save they didn't know touched them |
| Assume "delete coffee" is refused while links exist | Our join table's foreign keys are `ON DELETE CASCADE`, so the link rows go silently with the coffee (section 4.1). The opposite setting refuses the delete. Neither is "safe" on its own; you have to know which one you have | Whoever is surprised at 3am that a delete took more (or less) with it than expected |

## 8. 🧠 Senior engineer lens

- **Model the real world, then let it constrain you.** "Many on both sides" forces the third table. Fighting that with json blobs works until the first interesting question, and the first interesting question always comes.
- **Constraints in the database are the last line of defence.** Foreign keys refuse orphan links even when a bug, a script or a colleague's console session tries. Application checks can be skipped; the database can't be. The `ERROR: ... violates foreign key constraint` in section 3.4 is the database doing its job.
- **Decide what happens on delete.** `ON DELETE CASCADE` (what we have on the join table) versus refusing the delete versus setting the column to null: each is right somewhere. Cascading link rows is fine; cascading from a user to their invoices is how a company loses its books.
- **Knowing when data is fetched is a performance skill.** Relations, opt-in versus always-on loading, joins, N+1: most "the API is slow" tickets live here, not in your JavaScript. `logging: true` and counting queries is a habit, not a debugging trick.
- **Every list endpoint needs a limit, a default and a cap.** Flavors multiply rows (section 4.2), so a coffee list with relations and no pagination pulls far more than it looks (video 29).
- **Normalise first, denormalise deliberately.** Storing the word once is the default. Copying it for speed is a decision you make later, with numbers, knowing you now own keeping the copies in sync.

## 9. 🔗 Connects to
- [09 — Database, Docker & TypeORM](09-database-docker-typeorm.md): entities, repositories, `create` vs `save`, and §3.6 the connection pool that N+1 starves
- [07 — Pipes & Validation](07-pipes-validation.md) §6.1: why the DTO keeps words while the entity holds rows
- [04 — Shared state & the event loop](04-requests-shared-state-event-loop.md): `Promise.all` vs awaiting in a loop, and why one huge `find()` stalls everyone
- [11 — Transactions](11-transactions.md): the `START TRANSACTION … COMMIT` around the cascade save in section 4.3, and what happens when a crash lands in the middle
- [12 — Indexes & Migrations](12-indexes-migrations.md): the two `IDX_` indexes on the join table, and replacing `synchronize` so the next column rename doesn't drop data

## 10. ✍️ In my own words
> _(write here)_

## 11. 🛠️ Practice

1. **Prove the sharing.** Post two coffees that both include `"vanilla"`, then:
   ```bash
   docker compose exec db psql -U postgres -c "select * from flavor;" -c "select * from coffee_flavors;"
   ```
   One vanilla row, two link rows.
2. **Rename once, see it everywhere.** `update flavor set name = 'French Vanilla' where name = 'vanilla';`
   then `GET /coffee`. How many rows did you change, and how many coffees changed?
3. **Break a foreign key on purpose.** `insert into coffee_flavors ("coffeeId","flavorId") values (1, 999);`
   Read the error. Who refused, your code or the database?
4. **Feel N+1.** Turn on `logging: true`, call `GET /coffee` with and without `relations`. Count the queries.
5. **Add `GET /flavor`** listing flavors with their coffees. Which side needs `relations` now?
6. **Remove all flavors from a coffee** with a PATCH. Which of the three cases in section 3.5 is that?

<details><summary>Hints</summary>

- 1: `findOrCreateFlavor` runs a `findOne` by name before it creates anything. That lookup is the sharing.
- 2: count the rows `psql` reports as updated, then count the coffees whose JSON changed. They are different numbers on purpose.
- 3: the column names need double quotes in `psql` because TypeORM created them with capital letters. Compare the error's first word with anything your service could produce.
- 4: without `relations` you should see one `SELECT`. With `relations` you should still see one, but longer. If you see one per coffee, you've written the loop from section 3.5 somewhere.
- 5: you'll need a `FlavorService` (or at least a `FlavorController` with the flavor repository), and `find({ relations: { coffee: true } })`. The `@ManyToMany` on `Flavor` already knows the path back.
- 6: look at the table in section 3.5 and at what `updateCoffeeDto.flavor ? ... : undefined` does with `[]`. Is `[]` truthy?

</details>

## 12. ❓ Quiz

**Q1.** Why can't "a coffee has many flavors, a flavor has many coffees" live in two tables?

- A) It can, with a comma-separated string
- B) Each box holds one value, so one side would be limited to a single link, or the word would have to be duplicated per coffee
- C) Postgres doesn't allow it
- D) Only TypeORM needs the third table

<details><summary>Answer</summary>

**B.** The third table is a database fact, not a framework quirk. Every ORM in every language does the same thing. A comma-separated string (A) is Try 3 from section 3 in a different costume: the database still can't see inside the box.

</details>

**Q2.** `GET /coffee` returns coffees, but every `flavor` is missing. `select * from coffee_flavors` shows the links exist. What's wrong?

- A) The links weren't saved
- B) Nothing is wrong: relations aren't fetched unless you ask (`relations: { flavor: true }`)
- C) `cascade` is off
- D) `@JoinTable` is on the wrong side

<details><summary>Answer</summary>

**B.** Fetching a relation means the two `LEFT JOIN`s from section 4.2, which costs time and returns one row per pair, so it's opt-in per query. The links being in the table proves the write side is fine.

</details>

**Q3.** You post a coffee with a flavor that doesn't exist yet, and `cascade` is **not** set. What happens?

- A) The flavor is created anyway
- B) Saving fails: you're attaching a flavor row that was never inserted
- C) The coffee saves with no flavors, silently
- D) TypeORM inserts it on the next save

<details><summary>Answer</summary>

**B.** `create({ name })` only builds an object in memory; it has no id. In section 4.3's log, the `INSERT INTO "flavor"` line only exists because of `cascade: true`. Without it, either save the flavor yourself first, or turn cascade on.

</details>

**Q4.** A list page shows 100 coffees with their flavors. The endpoint fetches the coffees, then loops and fetches flavors for each. How many queries, and what's the fix?

- A) 1 query; it's fine
- B) 101 queries (N+1). Ask for the relation in the first query instead
- C) 2 queries
- D) 100, and it can't be improved

<details><summary>Answer</summary>

**B.** This scales with data, so it looks fine with 10 rows in dev (we measured 5 queries for 4 coffees) and falls over in production. One query with `relations` does the same work with one round trip.

</details>

**Q5.** `update flavor set name = 'French Vanilla' where id = 3;` — one row changed. How many coffees now show "French Vanilla", and what would have happened with the old json column?

- A) One coffee; json would behave the same
- B) Every coffee linked to flavor 3, because they all point at the same row. With json you'd have to find and rewrite each coffee's array, and any you missed would keep the old word
- C) None until you restart
- D) All coffees, json included

<details><summary>Answer</summary>

**B.** "Store it once, point at it" is the whole reason for the extra table.

</details>

**Q6.** `DELETE FROM coffee WHERE id = 5;` while `coffee_flavors` holds the pair `(5, 1)`. On our tables, what happens?

- A) Postgres refuses: the coffee still has links
- B) The coffee row and the pair `(5, 1)` are deleted; flavor 1 stays, because other coffees may share it
- C) The coffee, the pair and flavor 1 are all deleted
- D) The coffee is deleted and the pair is left pointing at nothing

<details><summary>Answer</summary>

**B.** Both foreign keys on our join table are `ON DELETE CASCADE` (section 4.1, real `\d` output), so the link rows follow the coffee. A is what you'd get with the *other* setting, which is also common, and you have to know which one you have. D is what the json column would have allowed and what a foreign key exists to prevent.

</details>
