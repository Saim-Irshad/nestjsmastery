// ============================================================================
// user.module.ts: GROUPS EVERYTHING ABOUT "USERS"
// ============================================================================
// A feature module: all user-related classes are registered here.
// AppModule imports this module, and that's how Nest finds these classes.
// ============================================================================

import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { UserLoggerService } from './user.logger.service';

@Module({
  controllers: [UserController],

  // BOTH services must be listed. Here's why:
  //   UserController needs UserService       -> UserService must be a provider
  //   UserService    needs UserLoggerService -> UserLoggerService must be a provider
  //
  // Remove UserLoggerService from this array and the app crashes at startup:
  //   "Nest can't resolve dependencies of the UserService (?)"
  // The "?" is the constructor argument Nest doesn't know how to create.
  //
  // Order in this array does NOT matter. Nest works out the order itself by
  // reading constructors (a dependency graph):
  //
  //   UserLoggerService   (needs nothing)     -> created 1st
  //          ↓
  //   UserService         (needs logger)      -> created 2nd
  //          ↓
  //   UserController      (needs userService) -> created 3rd
  //
  // Behind the scenes Nest keeps a "container", like a Map:
  //   Map {
  //     UserLoggerService => <the one logger object>,
  //     UserService       => <the one user service object>,
  //   }
  // When a constructor asks for a type, Nest looks it up in this Map.
  // If the object already exists it REUSES it, so everyone shares one instance.
  providers: [UserService, UserLoggerService],
})
export class UserModule {}
