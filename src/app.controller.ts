// ============================================================================
// app.controller.ts: HANDLES REQUESTS TO "/"
// ============================================================================

import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

// @Controller() with no argument means "these routes start at /".
// @Controller('user') would mean "these routes start at /user".
@Controller()
export class AppController {
  // --------------------------------------------------------------------------
  // THE CONSTRUCTOR LINE, EXPLAINED
  // --------------------------------------------------------------------------
  // `private readonly appService: AppService` inside the constructor's
  // parentheses is a TypeScript shortcut ("parameter property").
  // TypeScript expands it to:
  //
  //   private readonly appService: AppService;   // 1. declare a field
  //   constructor(appService: AppService) {
  //     this.appService = appService;            // 2. save the param on the object
  //   }
  //
  //   private  -> only code inside this class can use this.appService
  //   readonly -> after the constructor, it can't be reassigned
  //   : AppService -> the TYPE. Nest reads this to know WHAT to pass in.
  //
  // WHO CALLS THIS CONSTRUCTOR? Nest does, at startup:
  //   const appService    = new AppService();
  //   const appController = new AppController(appService);
  //
  // Your class says "I need an AppService". Nest provides one.
  // That's DEPENDENCY INJECTION: you ask for things instead of creating them.
  //
  // Why not write `appService = new AppService()` inside the class?
  //   - Nest creates ONE AppService and shares it everywhere (a "singleton").
  //     If every class made its own, data in one wouldn't be visible to others.
  //   - In tests you can pass in a fake AppService instead of the real one.
  // --------------------------------------------------------------------------
  constructor(private readonly appService: AppService) {}

  // @Get() connects this method to: GET http://localhost:3000/
  // When that request arrives, Nest calls  appController.getHello()
  @Get()
  getHello(): string {
    // `this` = the AppController object Nest created (it was called as
    //          appController.getHello(), so `this` is the thing before the dot).
    // `this.appService` = the AppService object saved in the constructor.
    // `.getHello()` = call its method. In the service method, `this` is
    //                 the appService object.
    return this.appService.getHello();
  }
}
