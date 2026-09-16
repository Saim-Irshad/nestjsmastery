// ============================================================================
// user.logger.service.ts: A SMALL DEPENDENCY
// ============================================================================
// This class exists to be INJECTED into UserService.
// It's a good way to see Dependency Injection in action.
// ============================================================================

import { Injectable } from '@nestjs/common';

// @Injectable() = "Nest, you may create this class and pass it to others."
// (It also has to be in the `providers` array of user.module.ts.)
@Injectable()
export class UserLoggerService {
  // No constructor, no fields. The object Nest creates is basically `{}`,
  // but it can call `log` because methods live on the shared prototype.
  //
  // Nest creates this exactly ONCE:  const logger = new UserLoggerService();
  // and passes that same object to every class that asks for it.
  log(message: string) {
    // Template string: backticks + ${} insert the variable's value.
    console.log(`[UserLoggerService] ${message}`);
  }
}

// Functional equivalent:
//   const createUserLogger = () => ({
//     log: (message) => console.log(`[UserLoggerService] ${message}`),
//   });
