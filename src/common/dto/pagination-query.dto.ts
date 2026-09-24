// ============================================================================
// pagination-query.dto.ts: ?limit=10&offset=20
// ============================================================================
// Lives in `common/` because it isn't about coffee. Any list endpoint (coffees,
// flavors, users, orders) takes the same two numbers.
//
// WHY LIST ENDPOINTS NEED THIS:
// `find()` with nothing else means "give me every row". With 20 rows in dev
// that looks fine. With 2 million rows in production, one request loads them
// all into memory, the whole app freezes while it builds them, and every other
// user waits (there's one thread — see notes/04).
//
//   GET /coffee?limit=10&offset=0   → rows 1–10
//   GET /coffee?limit=10&offset=10  → rows 11–20   ("page 2")
//
// Notes: notes/10-relations.md §7
// ============================================================================

import { Type } from 'class-transformer';
import { IsOptional, IsPositive } from 'class-validator';

export class PaginationQueryDto {
  // ⚠️ Everything in a URL is TEXT. `?limit=10` arrives as the string "10",
  // and "10" would be passed to the database as-is.
  // @Type(() => Number) says "turn this into a number first".
  // It only runs because main.ts has `transform: true` on the ValidationPipe.
  //
  // Check the order in your head: convert first, then validate. Without the
  // conversion, @IsPositive would be checking a string and would reject it.
  @IsPositive()
  @IsOptional()
  @Type(() => Number)
  offset: number;

  @IsPositive()
  @IsOptional()
  @Type(() => Number)
  limit: number;
}

// ⚠️ TWO THINGS TO FIX (see notes/10 §7):
//
// 1. @IsPositive() means "greater than 0", so `?offset=0` is REJECTED with 400,
//    even though offset 0 is the first page and the most common value.
//    Use @Min(0) for offset, and keep @IsPositive() (or @Min(1)) for limit.
//
// 2. Nothing caps `limit`. A client can ask for ?limit=1000000 and undo the
//    whole point of paginating. Real APIs cap it (@Max(100)) and apply a
//    default when the client sends nothing.
