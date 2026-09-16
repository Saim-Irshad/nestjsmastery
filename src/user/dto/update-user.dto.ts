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
// You can add extra fields later:
//   export class UpdateUserDto extends CreateUserDto {
//     email: string;   // now it has name AND email
//   }
//
// (Real Nest projects often use `PartialType(CreateUserDto)` from
// @nestjs/mapped-types, which makes every field OPTIONAL, since for an update
// you may only send some fields.)
// ---------------------------------------------------------------------------
export class UpdateUserDto extends CreateUserDto {}
