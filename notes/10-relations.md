# 10 — Relations: when one thing belongs to another

> 📍 **Where on the Big Map:** still the database layer, below the service.
> 📘 **Official course:** lesson26 Relations · lesson27 Fetching them · lesson28 Cascade · lesson29 Pagination
> 🌿 Branch: `relations`

## 1. The problem

A coffee tastes of vanilla and nutty. Cappuccino also tastes of vanilla. Write that down:

```
Latte      → vanilla, nutty
Cappuccino → vanilla
```

**A coffee has several flavors, and a flavor is used by several coffees.** Several on both sides.
A table is a grid where every box holds one value, so this doesn't fit in one table. Three tries:

**Try 1: a flavor column on coffee**
```
coffee
 id | name  | flavorId
 1  | Latte | 3          ← only vanilla. Where does nutty go?
```
One box, one value. You'd need `flavorId2`, `flavorId3`… and then someone wants four. Dead end.

**Try 2: a coffee column on flavor**
```
flavor
 id | name    | coffeeId
 1  | vanilla | 1          ← Latte's vanilla
 2  | vanilla | 2          ← Cappuccino's vanilla, a SECOND copy of the word
```
The word gets copied per coffee. Fix a typo in one and the rest stay wrong. "How many flavors do we sell?" gives a wrong answer. Dead end.

**Try 3: a list inside one box** (what we had: `flavor json` holding `["vanilla","nutty"]`)
Fine for showing one coffee, which is why it felt OK. It breaks the moment you ask the database anything:
- "which coffees have vanilla?" → open and read every JSON box, one at a time
- "rename vanilla everywhere" → rewrite thousands of boxes
- nothing stops `["vanila"]` or `["banana"]`, because there's no list of real flavors to check against

## 2. What works: a third table of pairs

Keep the two lists clean and store the **connections** separately. One row per connection:

```
coffee                    coffee_flavors             flavor
 id | name                 coffeeId | flavorId        id | name
 1  | Latte        ──┐        1     |    3    ┌──►    3  | vanilla
 2  | Cappuccino    │         1     |    5    │       5  | nutty
                    └──►      2     |    3    ┘
```

Read the middle table out loud: *"coffee 1 goes with flavor 3. Coffee 1 goes with flavor 5. Coffee 2 goes with flavor 3."*

- Latte has two flavors → two rows. Adding a third is one more row; no columns ever change.
- Vanilla belongs to two coffees → two rows.
- The word "vanilla" exists **once**. Rename it there and every coffee shows the new name.

The two labels the course puts on that table:

- **foreign key** on each column: *this number must match a real id in that other table.* The database itself refuses `coffeeId = 999` when there's no coffee 999, and refuses to delete a coffee that still has links. The JSON list could never promise that.
- **primary key** on the two columns together: *the same pair can't appear twice.* No linking Latte to vanilla twice.

**This is not a Nest or TypeORM idea.** Every relational database solves "many on both sides" this way. The common names for that middle table are *join table*, *link table* or *pivot table*.

The other two shapes you'll meet, for completeness:
- **one-to-many** (a user has many orders): no third table, the orders table just gets a `userId` column.
- **one-to-one** (a user has one profile): a `profileId` column on one of them.
Only **many-to-many** needs the extra table.

## 3. How we wrote it

```ts
// coffee.entity.ts
@JoinTable({ name: 'coffee_flavors' })
@ManyToMany((type) => Flavor, (flavor) => flavor.coffee, { cascade: true })
flavor?: Flavor[];

// flavor.entity.ts
@ManyToMany((type) => Coffee, (coffee) => coffee.flavor)
coffee: Coffee[];
```

| Piece | What it means |
|---|---|
| `@ManyToMany` on both sides | "many on both ends" → TypeORM builds the third table |
| `@JoinTable()` on **one** side | that side owns the link table. Leave the option out and it invents a name: `coffee_flavor_flavor` (entity + property + entity) |
| `(type) => Flavor` | the two files import each other, so the class isn't ready yet when the file loads. Handing over a function delays the lookup until both exist |
| `(flavor) => flavor.coffee` | which property on the other side points back here |
| `{ cascade: true }` | when a coffee is saved, also insert brand-new flavor rows attached to it |
| `flavor?: Flavor[]` | rows now, not words |

Because `synchronize: true` is on, restarting the app creates `flavor` and `coffee_flavors`, and **drops the old json column with its data**. Fine locally; in lesson32 this becomes migration files instead.

## 4. Fetching them, and the price

Relations are **not** fetched by default:

```ts
this.coffeeRepositery.find();                              // coffees only
this.coffeeRepositery.find({ relations: { flavor: true } }); // coffees + their flavors
```

Why not always? Because it stops being one simple `SELECT`. The database has to walk
coffee → coffee_flavors → flavor and stitch the rows back together (a **join**), and that costs time.
You ask for it when you need it.

⚠️ **The classic mistake this prevents (N+1):** fetching 100 coffees, then looping and fetching each
coffee's flavors inside the loop = 1 + 100 queries. Asking for the relation up front = 1 query.
When an endpoint is mysteriously slow, this is the first thing to look for.

## 5. The translation step (the part that isn't obvious)

The client sends words; the coffee holds rows. Something must convert:

```ts
private async findOrCreateFlavor(name: string): Promise<Flavor> {
  const existingFlavor = await this.flavorRepositery.findOne({ where: { name } });
  if (existingFlavor) return existingFlavor;        // reuse the shared row
  return this.flavorRepositery.create({ name });    // memory only; cascade saves it
}
```

Used like this:

```ts
const flavors = await Promise.all(
  (createCoffeeDto.flavor ?? []).map((name) => this.findOrCreateFlavor(name)),
);
const coffeeEntity = this.coffeeRepositery.create({ ...createCoffeeDto, flavor: flavors });
```

**Why `Promise.all`?** `.map` with an async function gives a list of unfinished database trips
(`["vanilla","nutty"] → [Promise, Promise]`). `Promise.all` waits for all of them and hands back the results.

```
await in a loop:   vanilla ─5ms─► nutty ─5ms─► caramel ─5ms─►   = 15ms
Promise.all:       all three at once                            = 5ms
```

Harmless with 3 items, painful with 50. **"`await` inside a loop" is one of the most common causes of slow endpoints.**
If any one fails, `Promise.all` throws, so you never save a coffee with half its flavors.

**On update, three cases must stay apart:**

| Client sends | We pass | Meaning |
|---|---|---|
| nothing | `undefined` | leave flavors alone |
| `[]` | `[]` | remove all flavors |
| `["vanilla"]` | `[row]` | replace with this list |

## 5b. Pagination (video 29)

`find()` with nothing else means **"give me every row"**. Fine with 20 rows in dev; with 2 million it loads
them all into memory, and since one thread serves everyone (note 04), **every other user waits** while it does.

So list endpoints take two numbers:

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

// controller: @Query() with no name = the whole query string as one object
findAll(@Query() paginationQuery: PaginationQueryDto) { ... }

// service
this.coffeeRepositery.find({ skip: paginationQuery.offset, take: paginationQuery.limit });
//                            ↑ SQL OFFSET              ↑ SQL LIMIT
```

**Everything in a URL is text.** `?limit=10` arrives as `"10"`. `@Type(() => Number)` converts it first,
then the rules run (it works because `transform: true` is on in `main.ts`). Without the conversion,
`@IsPositive()` would be checking a string.

**Two holes in our current version:**

1. `@IsPositive()` means "> 0", so **`?offset=0` is rejected** — and offset 0 is the first page.
   Use `@Min(0)` for offset; keep `@IsPositive()` (or `@Min(1)`) for limit.
2. **Nothing caps `limit`.** `?limit=1000000` undoes the whole point. Real APIs cap it (`@Max(100)`) and
   apply a default when the client sends nothing, so "no parameters" never means "the entire table".

**The deeper problem with offset** (worth knowing before you ever need it): to skip 100,000 rows the database
still walks past them, so page 5,000 is much slower than page 1. And if someone inserts a row while a user
is paging, rows shift and an item can appear twice or be skipped. Feeds and infinite scroll use
**cursor paging** instead: "give me the 20 after id X", which stays fast at any depth and doesn't shift.
Offset paging is fine for admin tables with page numbers.

## 6. ❌ How NOT to do it

| Don't | What goes wrong |
|---|---|
| Keep a list of words in a json column | Can't search, can't rename in one place, nothing checks the words are real |
| Copy the word into every child row | Duplicates that drift apart; counts and renames become impossible |
| `@JoinTable()` on both sides | Two link tables, or a startup error. One owner only |
| Expect relations without asking | `coffee.flavor` is undefined; you didn't ask for it |
| Fetch a list, then query each item's relations in a loop | N+1 queries; the classic slow endpoint |
| `@PrimaryColumn()` when you don't supply ids | We hit this: the service creates flavors from a name alone and has no id to give. `@PrimaryGeneratedColumn()` lets Postgres number them |
| Put database ids in the request DTO | Clients would have to know internal ids. Let them send words; translate on the server |
| Leave `cascade: true` on everywhere | Convenient for flavors; dangerous when saving one thing quietly rewrites a tree of related rows. Turn it on where you mean it |

## 7. 🧠 Senior engineer lens

- **Model the real world, then let it constrain you.** "Many on both sides" forces the third table. Fighting that with json blobs works until the first interesting question.
- **Constraints in the database are the last line of defense.** Foreign keys refuse orphan links even when a bug, a script or a colleague's console session tries. Application checks can be skipped; the database can't be.
- **Knowing when data is fetched is a performance skill.** Relations, lazy vs eager, joins, N+1: most "the API is slow" tickets live here, not in your JS.
- **Every list endpoint needs a limit.** Flavors multiply rows; a coffee list with relations and no pagination pulls far more than it looks (lesson29).
- **Normalize first, denormalize deliberately.** Storing the word once is the default. Copying it for speed is a decision you make later, with numbers, knowing you now own keeping the copies in sync.

## 8. 🔗 Connects to
- [09 — Database, Docker & TypeORM](09-database-docker-typeorm.md): entities, repositories, `create` vs `save`
- [07 — Pipes & Validation](07-pipes-validation.md) §6.1: why the DTO keeps words while the entity holds rows
- [04 — Shared state & the event loop](04-requests-shared-state-event-loop.md): `Promise.all` vs awaiting in a loop
- 11 — Transactions, indexes, migrations: saving coffee + flavors as one unit, and replacing `synchronize`

## 9. ✍️ In my own words
> _(write here)_

## 10. 🛠️ Practice

1. **Prove the sharing.** Post two coffees that both include `"vanilla"`, then:
   ```bash
   docker compose exec db psql -U postgres -c "select * from flavor;" -c "select * from coffee_flavors;"
   ```
   One vanilla row, two link rows.
2. **Rename once, see it everywhere.** `update flavor set name = 'French Vanilla' where name = 'vanilla';`
   then `GET /coffee`. How many rows did you change, and how many coffees changed?
3. **Break a foreign key on purpose.** `insert into coffee_flavors (coffeeid, flavorid) values (1, 999);`
   Read the error. Who refused, your code or the database?
4. **Feel N+1.** Turn on `logging: true`, call `GET /coffee` with and without `relations`. Count the queries.
5. **Add `GET /flavor`** listing flavors with their coffees. Which side needs `relations` now?
6. **Remove all flavors from a coffee** with a PATCH. Which of the three cases in section 5 is that?

## 11. ❓ Quiz

**Q1.** Why can't "a coffee has many flavors, a flavor has many coffees" live in two tables?

- A) It can, with a comma-separated string
- B) Each box holds one value, so one side would be limited to a single link, or the word would have to be duplicated per coffee
- C) Postgres doesn't allow it
- D) Only TypeORM needs the third table

<details><summary>Answer</summary>

**B.** The third table is a database fact, not a framework quirk. Every ORM in every language does the same thing.

</details>

**Q2.** `GET /coffee` returns coffees, but every `flavor` is missing. `select * from coffee_flavors` shows the links exist. What's wrong?

- A) The links weren't saved
- B) Nothing is wrong: relations aren't fetched unless you ask (`relations: { flavor: true }`)
- C) `cascade` is off
- D) `@JoinTable` is on the wrong side

<details><summary>Answer</summary>

**B.** Fetching a relation means a join, which costs time, so it's opt-in per query.

</details>

**Q3.** You post a coffee with a flavor that doesn't exist yet, and `cascade` is **not** set. What happens?

- A) The flavor is created anyway
- B) Saving fails: you're attaching a flavor row that was never inserted
- C) The coffee saves with no flavors, silently
- D) TypeORM inserts it on the next save

<details><summary>Answer</summary>

**B.** `create({ name })` only builds an object in memory. Either `cascade: true`, or save the flavor yourself first.

</details>

**Q4.** A list page shows 100 coffees with their flavors. The endpoint fetches the coffees, then loops and fetches flavors for each. How many queries, and what's the fix?

- A) 1 query; it's fine
- B) 101 queries (N+1). Ask for the relation in the first query instead
- C) 2 queries
- D) 100, and it can't be improved

<details><summary>Answer</summary>

**B.** This scales with data, so it looks fine with 10 rows in dev and falls over in production.

</details>

**Q5.** `update flavor set name = 'French Vanilla' where id = 3;` — one row changed. How many coffees now show "French Vanilla", and what would have happened with the old json column?

- A) One coffee; json would behave the same
- B) Every coffee linked to flavor 3, because they all point at the same row. With json you'd have to find and rewrite each coffee's array, and any you missed would keep the old word
- C) None until you restart
- D) All coffees, json included

<details><summary>Answer</summary>

**B.** "Store it once, point at it" is the whole reason for the extra table.

</details>
