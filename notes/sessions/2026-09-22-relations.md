# 2026-09-22 · Relations: coffee ↔ flavors

> **Branch:** `relations` (from `main` at b9f11f3)
> **Course:** videos 26–29 · **Note:** [10 Relations](../10-relations.md)

## What I built

- **`Flavor` entity**: flavors moved out of the coffee row into their own table.
- **Many-to-many link between coffee and flavor**, so Postgres now has **three** tables:
  `coffee`, `flavor`, and `coffee_flavors` (just pairs of ids).
- **`findOrCreateFlavor(name)`** in `CoffeeService`: turns a word the client sent into a real flavor row,
  reusing the existing one when it's already there.
- **`create` and `updateById`** now translate the words into rows before saving, and `findAll` asks for the
  flavors with `relations: { flavor: true }`.
- **Pagination** (video 29): `PaginationQueryDto` in `src/common/dto/` with `limit` and `offset`,
  `@Query()` on the controller, `skip`/`take` in the service → `LIMIT`/`OFFSET` in the SQL.

## The idea, in one picture

```
coffee                    coffee_flavors             flavor
 id | name                 coffeeId | flavorId        id | name
 1  | Latte        ──┐        1     |    3    ┌──►    3  | vanilla
 2  | Cappuccino    │         1     |    5    │       5  | nutty
                    └──►      2     |    3    ┘
```

A coffee has many flavors **and** a flavor belongs to many coffees, so the connections need their own table.
The word "vanilla" is stored once and shared.

## What broke, and why

| Problem | What it really meant | Fix |
|---|---|---|
| `Type 'string' is not assignable to type 'Flavor'` (3 errors) | The DTO still said flavors are words; the entity now says they're rows | translate in the service (`findOrCreateFlavor`) instead of passing the body straight through |
| `Type 'string[]' has no properties in common with 'FindOptionsRelations<Coffee>'` | `relations` wants an object, not a list of names | `relations: { flavor: true }` |
| `Flavor` had `@PrimaryColumn()` | that means *I* supply every id, but the service creates flavors from a name alone | `@PrimaryGeneratedColumn()` |
| generated file landed in a folder literally named `pagination-query.dto.ts` | `nest g` path typo | moved to `src/common/dto/pagination-query.dto.ts`, imports updated |
| `POST` with `"flavor": "vanilla"` (text, not a list) → **500** | `@IsString({ each: true })` is a rule about the ITEMS of a list. It never says "this must be a list", so a plain string passed the check, then the service did `"vanilla".map(...)` → `TypeError: .map is not a function` | added `@IsArray()`. Now it's a 400, not a crash |

**How to read those walls of TypeScript errors** (worth keeping): read the **last line** first — that's the real
mismatch in a few words. Then search upwards for `property 'x'` to see which field. The underlined line tells you
where. Then open both types and compare that one field. Fix the first error, recompile; the rest often vanish.

## Things I understood this session

- The third table is a **database** fact, not a TypeORM quirk. Every relational database does this.
- Relations are **not** fetched unless you ask, because fetching them means a join, which costs time.
- `cascade: true` is what lets a brand-new flavor get inserted when the coffee is saved.
- `Promise.all` vs awaiting in a loop: same result, but the loop asks one question at a time. With 50 items
  that's the difference between fast and slow.
- Why the flavor lookup lives in `CoffeeService`: "create a coffee" is the job, and resolving its flavors is
  part of doing that job. Flavors get their own service when they get their own routes.
- Renamed `preloadFlavorByName` → `findOrCreateFlavor`. `preload` is TypeORM's word for something else; a name
  that describes the wrong thing is worse than a long one.

## Still open

1. `deleteById` returns `{ affected: 1 }` instead of the deleted coffee.
2. Pagination holes: `@IsPositive()` rejects `?offset=0` (should be `@Min(0)`), and `limit` has no maximum
   and no default, so sending no parameters still fetches the whole table.
3. Decide whether to rename `flavor` → `flavors` and `coffee` → `coffees` (they're lists).
4. Practice tasks in [note 10](../10-relations.md): prove the sharing, break a foreign key on purpose, count
   queries with `logging: true`, add `GET /flavor`.
5. The old json `flavor` column was dropped when the app restarted: a live demo of why `synchronize: true`
   is banned in production (video 32 replaces it with migrations).
