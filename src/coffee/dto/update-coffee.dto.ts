// ============================================================================
// update-coffee.dto.ts: WHAT A CLIENT MAY SEND TO  PATCH/PUT /coffee/:id
// ============================================================================
// Updating is different from creating: the client usually wants to change ONE
// field and leave the rest alone.
//
// PartialType(CreateCoffeeDto) is a function that builds a new class for us:
// same fields, same rules, but every field is now optional.
//
//   { "name": "Latte" }      → ok (brand untouched)
//   { "brand": "Sbux" }      → ok
//   { "name": 5 }            → 400, the rule still applies to what IS sent
//   { }                      → ok, nothing to change
//
// We learned this the hard way on the user module, where UpdateUserDto simply
// extended CreateUserDto and inherited "email is required", so an update that
// only changed the name was rejected. Same trap, same fix.
// ============================================================================

import { PartialType } from '@nestjs/mapped-types';
import { CreateCoffeeDto } from './create-coffee.dto';

export class UpdateCoffeeDto extends PartialType(CreateCoffeeDto) {}
