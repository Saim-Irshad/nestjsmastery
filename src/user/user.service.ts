// ============================================================================
// user.service.ts: THE BUSINESS LOGIC FOR USERS
// ============================================================================
// This file shows the most important class ideas in one place:
//   - constructor + dependency injection
//   - fields (data stored on the object)
//   - `this` (how methods reach that data)
// ============================================================================

import { Injectable, NotFoundException } from '@nestjs/common';
import { UserLoggerService } from './user.logger.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UserService {
  // ---------------------------------------------------------------------------
  // THE LONG WAY (what the one-line constructor below expands into):
  // ---------------------------------------------------------------------------
  //   private readonly userLoggerService: UserLoggerService; // declare the field
  //
  //   constructor(userLoggerService: UserLoggerService) {
  //     this.userLoggerService = userLoggerService; // save it on the object
  //   }
  //
  // ---------------------------------------------------------------------------
  // THE SHORT WAY (TypeScript "parameter property"):
  // ---------------------------------------------------------------------------
  // Putting `private readonly` in front of the parameter makes TypeScript
  // write the `this.userLoggerService = userLoggerService;` line for you.
  // So the empty `{}` body is not empty in the compiled JS.
  //
  // Try it: remove `private readonly` and the app compiles with an error on
  // `this.userLoggerService` below, because no field was created and the value
  // was only a temporary parameter that vanished when the constructor ended.
  //
  // WHY SAVE IT ON `this` AT ALL?
  // The methods below (getUserByName etc.) are separate functions. They
  // can't see the constructor's local variables (unlike closures in functional
  // code). The object is the one thing that survives and that every method
  // can reach through `this`, so we store the data there.
  // ---------------------------------------------------------------------------
  constructor(private readonly userLoggerService: UserLoggerService) {}

  // ---------------------------------------------------------------------------
  // A FIELD WITH A STARTING VALUE ("field initializer")
  // ---------------------------------------------------------------------------
  // This line isn't run "on its own". It runs every time `new` is called.
  //
  // Run `pnpm build` and open dist/user/user.service.js. This is the REAL
  // compiled JavaScript (TypeScript types and `private readonly` are gone):
  //
  //   class UserService {
  //     userLoggerService;                 // field declared (starts undefined)
  //     constructor(userLoggerService) {
  //       this.userLoggerService = userLoggerService; // <- the shortcut's line
  //     }
  //     users = [ {id:1...}, ... ];        // field with a starting value
  //     getUserByName(name) { ... }
  //   }
  //
  // What `new UserService(logger)` does, step by step:
  //   1. obj = {}                            // `new` makes an empty object
  //   2. obj.userLoggerService = undefined   // fields are set up first...
  //   3. obj.users = [ {id:1...}, ... ]      // ...in the order they're written
  //   4. run constructor body with this = obj:
  //        obj.userLoggerService = logger
  //   5. return obj
  //
  // "Initializing a field" = giving the object's property its first value.
  //
  // `private` -> the controller can't do `this.userService.users`. Only this
  //              class's methods can touch the array. Other code must go
  //              through methods like getUserById.
  //
  // ⚠️ This array lives IN MEMORY on the one shared UserService object.
  // Nest creates UserService once, so users added via POST stay while the
  // server runs, and disappear when you restart (or when --watch reloads
  // after a file save). A real app would use a database.
  // ---------------------------------------------------------------------------
  // `User[]` gives the array an explicit shape. Without it, TypeScript guesses
  // the type from the starting values ({ id, name } only), so `user.email = ...`
  // in updateUser would be a compile error.
  private users: User[] = [
    { id: 1, name: 'saim' },
    { id: 2, name: 'Jane Smith' },
    { id: 3, name: 'Alice Johnson' },
  ];

  // ---------------------------------------------------------------------------
  // METHODS
  // ---------------------------------------------------------------------------
  // Called as  userService.getUserByName("saim"),  so inside, `this` = userService.
  getUserByName(name: string) {
    // `this.users` = the array field on this object.
    //
    // The arrow function `(user) => user.name === name` is a callback.
    // It can see `name` because arrow functions are closures (the functional
    // idea you already know). Arrow functions also DON'T get their own
    // `this`; they use the surrounding one. So if you wrote `this.users`
    // inside the arrow, it would still mean the service. A regular
    // `function () {}` callback would lose `this`.
    const user = this.users.find((user) => user.name === name);

    // Using the INJECTED dependency: the logger object Nest passed in.
    // We never wrote `new UserLoggerService()` anywhere. Nest did it.
    this.userLoggerService.log(`Searching for user with name: ${name}`);

    if (user) {
      return user;
    } else {
      throw new NotFoundException(`User with name "${name}" not found`);
    }
  }

  // `id` is already a NUMBER here. The controller's ParseIntPipe converted it
  // ("2" → 2) and rejected junk like "1abc" with a 400 before we got here.
  // Before the fix this took a string and did `parseInt(id)`, and
  // parseInt("1abc") === 1, so /user/1abc returned user 1.
  // Converting input is the edge's job (pipes), not the business logic's.
  getUserById(id: number) {
    const user = this.users.find((user) => user.id === id);
    if (user) {
      return user;
    } else {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }
  }

  // Takes the whole DTO now instead of just `name`: when the DTO grows
  // (email, age...), this signature doesn't change.
  createUser(dto: CreateUserDto) {
    const newUser: User = {
      // Uses the current array length to make the next id.
      // (Simple, but if you ever delete users this can create duplicate ids.)
      id: this.users.length + 1,

      // FIXED (2026-09-18): copy only the fields we mean, instead of `...dto`.
      //
      // `...dto` copied EVERY property the body had, not only the ones the
      // CreateUserDto type lists (TypeScript types don't exist at runtime).
      // Tested before the fix:
      //   POST { "name": "hacker", "email": "h@x.com", "isAdmin": true }
      //   → saved as { id: 5, name: 'hacker', email: 'h@x.com', isAdmin: true }
      // And since `...dto` came AFTER `id`, a body with { "id": 1 } could even
      // overwrite the generated id.
      //
      // Two layers of defense now:
      //   1. ValidationPipe({ whitelist, forbidNonWhitelisted }) rejects unknown fields (main.ts)
      //   2. here, explicit fields, so even if someone later weakens the pipe
      //      or adds `role` to this DTO for an admin route, nothing extra is written.
      name: dto.name,
      email: dto.email,
    };

    // .push CHANGES the array stored on the object. Because the same
    // UserService object handles every request, the next GET will see it.
    this.users.push(newUser);

    return newUser;
  }

  // FIXED (2026-09-18): takes the whole UpdateUserDto, where every field is
  // OPTIONAL (PartialType). Before, it took only `name`, so once name became
  // optional, PUT { "email": "x@y.com" } would have set name to undefined.
  // Now: only fields the client actually sent get changed.
  updateUser(id: number, dto: UpdateUserDto) {
    const user = this.users.find((user) => user.id === id);
    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    // `find` returns a REFERENCE to the object inside the array (note 02:
    // variables hold addresses), so changing `user` changes the stored user.
    if (dto.name !== undefined) user.name = dto.name;
    if (dto.email !== undefined) user.email = dto.email;
    return user;
  }
}

// The shape of a stored user. `email?` = optional, because the seed users
// above were created before email existed. (With a real DB, this would be an
// entity class: course lesson24, "Creating a TypeORM Entity".)
export interface User {
  id: number;
  name: string;
  email?: string;
}

// ============================================================================
// THE SAME SERVICE WRITTEN FUNCTIONALLY (for comparison)
// ============================================================================
//   function createUserService(userLoggerService) {  // <- constructor param
//     const users = [ { id: 1, name: 'saim' }, ... ]; // <- private field
//
//     return {
//       getUserByName(name) {
//         const user = users.find((u) => u.name === name); // closure, no `this`
//         userLoggerService.log(`Searching for user with name: ${name}`);
//         return user ?? { message: 'User not found' };
//       },
//       // ...other methods
//     };
//   }
//
//   const logger      = createUserLogger();          // what Nest does for you
//   const userService = createUserService(logger);   //   (Dependency Injection)
//
// Class version: data is stored on the object, and methods reach it through `this`.
// Functional version: data is stored in closure variables, and inner functions see it directly.
// ============================================================================
