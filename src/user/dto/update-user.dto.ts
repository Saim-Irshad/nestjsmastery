// ============================================================================
// update-user.dto.ts: SHAPE OF THE BODY FOR  PUT /user/:id
// ============================================================================

import { CreateUserDto } from './create-user.dto';

// ---------------------------------------------------------------------------
// `extends` = INHERITANCE: "UpdateUserDto gets everything CreateUserDto has."
// ---------------------------------------------------------------------------
// So even though the braces are empty, UpdateUserDto has `name: string`.
//
// Functional comparison: it's like object spread
//   const createUserShape = { name: 'string' };
//   const updateUserShape = { ...createUserShape };   // copy everything, add more if needed
//
// ⚠️ BUG since the validation decorators were added (tested 2026-09-18):
// `extends` ALSO inherits the validation RULES, including "email is required".
//   PUT /user/1  { "name": "saim2" }
//   → 400 ["Email must be a valid email address"]
// The client only wanted to change the name.
//
// Fix: PartialType from @nestjs/mapped-types (`pnpm add @nestjs/mapped-types`):
//   export class UpdateUserDto extends PartialType(CreateUserDto) {}
// PartialType(X) is a FUNCTION that builds a new class at runtime: same fields
// and same rules as X, but every field gets @IsOptional(). "If you send it, it
// must be valid; you don't have to send it."
// (Official course: lesson 20, "Validate Input Data with Data Transfer Objects")
// ---------------------------------------------------------------------------
export class UpdateUserDto extends CreateUserDto {}
