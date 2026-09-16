// ============================================================================
// app.service.ts: THE SIMPLEST POSSIBLE SERVICE
// ============================================================================
// A "service" is a class that holds your business logic (the actual work).
// Controllers receive requests; services do the work.
// ============================================================================

import { Injectable } from '@nestjs/common';

// @Injectable() is a decorator (a function that runs on the class; see
// app.module.ts). It marks this class as something Nest can create and
// hand to other classes.
//
// There's a second, less obvious job. It makes TypeScript save the TYPES
// of the constructor parameters at runtime (needs "emitDecoratorMetadata"
// in tsconfig). Normally TS types are erased when compiled to JS. This
// class has no constructor, so here it's just a marker.
@Injectable()
export class AppService {
  // ------------------------------------------------------------------------
  // No constructor written?
  // Then JS gives you an invisible empty one: `constructor() {}`.
  // `new AppService()` still works and gives back an object with no fields,
  // but it can still use the getHello method.
  // ------------------------------------------------------------------------

  // A METHOD: a function that belongs to the class.
  // ": string" is TypeScript saying "this function returns a string".
  //
  // Where does this function live? Not copied into every object.
  // It's stored ONCE on AppService.prototype and every AppService object
  // shares it. (That's why methods can't see constructor variables and you
  // need `this.` to reach data. See user.service.ts.)
  getHello(): string {
    return 'Hello World!';
  }
}

// Functional equivalent of this whole file:
//   function createAppService() {
//     return { getHello: () => 'Hello World!' };
//   }
