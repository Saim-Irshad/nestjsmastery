// ============================================================================
// update-user.dto.ts: SHAPE OF THE BODY FOR  PUT /user/:id
// ============================================================================

import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';

// ---------------------------------------------------------------------------
// HISTORY: this used to be `extends CreateUserDto`
// ---------------------------------------------------------------------------
// `extends` = INHERITANCE: "UpdateUserDto gets everything CreateUserDto has."
// Functional comparison: object spread, { ...createUserShape }.
//
// Bug found 2026-09-18: `extends` ALSO inherited the validation RULES,
// including "email is required".
//   PUT /user/1  { "name": "saim2" }
//   → 400 ["Email must be a valid email address"]
// The client only wanted to change the name.
//
// ---------------------------------------------------------------------------
// FIX: PartialType(CreateUserDto)
// ---------------------------------------------------------------------------
// PartialType is a FUNCTION that builds and returns a NEW CLASS at runtime:
// same fields and same rules as CreateUserDto, but each field also gets
// @IsOptional(). So "if you send it, it must be valid; you don't have to send it":
//   { "name": "saim2" }            → ok
//   { "email": "new@x.com" }       → ok
//   { "name": "a" }                → 400 (still must be ≥ 3 chars IF sent)
//   {}                             → ok (nothing to change)
//
// `extends PartialType(CreateUserDto)` works because in JS you can extend
// ANY expression that returns a class. `extends` doesn't need a name.
//
// It also changes the TypeScript type: name?: string, email?: string.
//
// (Official course: lesson14.mp4, "Validate Input Data with Data Transfer Objects")
// ---------------------------------------------------------------------------
export class UpdateUserDto extends PartialType(CreateUserDto) {}
