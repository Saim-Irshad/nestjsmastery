// ============================================================================
// create-coffee.dto.ts: WHAT A CLIENT IS ALLOWED TO SEND TO  POST /coffee
// ============================================================================
// The global checker in main.ts reads the decorators below on every request.
// Anything that fails → 400, and the controller never runs.
//
// ⚠️ THE BUG WE HIT (2026-09-22):
// This class used to be `extends PartialType(Coffee)`, reusing the entity.
// Every POST came back with:
//     400 ["property name should not exist",
//          "property brand should not exist",
//          "property flavor should not exist"]
// Reason: the entity's @Column() notes are for TypeORM. The request checker
// (class-validator) keeps its OWN list of rules, and that list was empty, so
// every field looked like an unknown extra field and got rejected.
// Fix: this class has its own rules, written below.
// Why not reuse the entity anyway: notes/07-pipes-validation.md §6.1
// ============================================================================

import { IsOptional, IsString } from 'class-validator';

export class CreateCoffeeDto {
  // "must be text, and must be present"
  @IsString()
  name: string;

  @IsString()
  brand: string;

  // `each: true` = check every item INSIDE the array, so ["vanilla"] passes
  // and ["vanilla", 5] fails.
  //
  // @IsOptional() = "skip all checks if this field wasn't sent".
  // Without it, the `?` above means nothing at runtime (TypeScript is gone by
  // then), so a body without `flavor` would be rejected.
  @IsString({ each: true })
  @IsOptional()
  flavor?: string[];
}
