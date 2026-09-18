// ============================================================================
// create-user.dto.ts: DTO = "Data Transfer Object"
// ============================================================================
// A DTO describes the SHAPE of data coming in (usually the request body).
//
// e.g.  POST /user   body: { "name": "Ali" }
//
// ⚠️ IMPORTANT CONCEPT: this class is used mainly as a TYPE.
// When a request comes in, Nest does NOT run `new CreateUserDto()`.
// The body is a plain object parsed from JSON: { name: "Ali" }.
// TypeScript lets you *treat* it as a CreateUserDto, but nothing checks at
// runtime that `name` really exists or is a string. Sending { "age": 5 }
// would still get through. Checking that is what ValidationPipe +
// class-validator are for (added below, see "UPDATE (Day 4)").
//
// Why a CLASS and not a TypeScript `interface`/`type`?
// Interfaces are completely erased when compiled to JS. Classes still exist
// at runtime, so Nest (and validation libraries) can read information
// about them. So Nest prefers classes for DTOs.
// ============================================================================

import { IsEmail, IsString, MinLength } from 'class-validator';

// ============================================================================
// UPDATE (Day 4): NOW THE DTO IS CHECKED AT RUNTIME
// ============================================================================
// `: string` alone checks nothing at runtime (TypeScript types are erased).
// The decorators below are what really runs. Each one is a function that
// attaches a rule to the property (same "sticky label" idea as @Module):
//   Reflect: CreateUserDto.name  → [IsString, MinLength(3)]
//   Reflect: CreateUserDto.email → [IsEmail]
//
// The global ValidationPipe (main.ts) reads those labels on every request:
//   JSON body ─► plainToInstance(CreateUserDto, body) ─► validate(instance)
//            ─► errors? throw 400 with all messages : call the controller
//
// Tested:
//   { "name": "al" }            → 400 ["Name must be at least 3 characters long",
//                                      "Email must be a valid email address"]
//   { "name": 123, ... }        → 400 ["...at least 3 characters", "Name must be a string"]
//   { name, email, isAdmin }    → 201 ⚠️ isAdmin is NOT rejected (no rule = not checked).
//                                 Fix: ValidationPipe({ whitelist: true }) in main.ts.
// ============================================================================
export class CreateUserDto {
  // A FIELD DECLARATION with no value. It says "objects of this type have
  // a `name` that is a string". No constructor sets it here, because the
  // value comes from the request body, not from `new`.
  //
  // Decorators run bottom-up when the file loads, but the order of the
  // error MESSAGES isn't something to rely on in the frontend.
  // `{ message: ... }` replaces the default English message ("name must be a string").
  @IsString({ message: 'Name must be a string' })
  @MinLength(3, { message: 'Name must be at least 3 characters long' })
  name: string;

  // IsEmail(options, validationOptions): first `{}` = email-format options
  // (e.g. { allow_display_name: true }), second = message etc.
  // Only checks the FORMAT. It doesn't check that the email exists or is unique;
  // uniqueness is a business rule → service + a DB unique index.
  @IsEmail({}, { message: 'Email must be a valid email address' })
  email: string;
}
