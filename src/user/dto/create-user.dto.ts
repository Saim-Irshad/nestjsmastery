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
// class-validator are for (you'll learn those later).
//
// Why a CLASS and not a TypeScript `interface`/`type`?
// Interfaces are completely erased when compiled to JS. Classes still exist
// at runtime, so Nest (and validation libraries) can read information
// about them. So Nest prefers classes for DTOs.
// ============================================================================

export class CreateUserDto {
  // A FIELD DECLARATION with no value. It says "objects of this type have
  // a `name` that is a string". No constructor sets it here, because the
  // value comes from the request body, not from `new`.
  name: string;
}
