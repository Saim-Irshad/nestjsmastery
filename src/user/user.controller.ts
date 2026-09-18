// ============================================================================
// user.controller.ts: RECEIVES HTTP REQUESTS FOR /user
// ============================================================================
// A controller's job: read what the request has (URL params, query, body),
// then hand the real work to the service. Keep controllers thin.
// ============================================================================

import {
  Controller,
  Get,
  Param,
  Body,
  Post,
  Query,
  Put,
  ParseIntPipe,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserService } from './user.service';

// @Controller('user') = every route in this class starts with /user
@Controller('user')
export class UserController {
  // --------------------------------------------------------------------------
  // CONSTRUCTOR: "To exist, I need a UserService."
  // --------------------------------------------------------------------------
  // Expanded by TypeScript into:
  //   private readonly userService: UserService;
  //   constructor(userService: UserService) {
  //     this.userService = userService;
  //   }
  //
  // At startup Nest does:  new UserController(<the shared UserService object>)
  // After that, every method below can reach it with `this.userService`.
  //
  // IMPORTANT: Nest creates this controller ONCE, not once per request.
  // Every request to /user uses the SAME controller object and the SAME
  // UserService object. That's why the `users` array in the service keeps
  // changes between requests.
  // --------------------------------------------------------------------------
  constructor(private readonly userService: UserService) {}

  // EXPERIMENT: a field on the ONE shared controller object.
  // It's set to 0 only once, when Nest runs `new UserController(...)` at startup.
  // Every request, from any browser or person, increments the SAME number.
  // It resets only when the server restarts (or --watch reloads after a save).
  private requestCount = 0;

  // --------------------------------------------------------------------------
  // GET /user?name=saim
  // --------------------------------------------------------------------------
  // @Get() with no path = GET /user
  // @Query('name') is a PARAMETER decorator. It tells Nest what to pass in:
  // "take req.query.name and pass it as the `name` argument".
  // Without decorators you'd write it by hand, Express-style:
  //   (req, res) => { const name = req.query.name; ... }
  @Get()
  getUser(@Query('name') name: string) {
    // `this` on its own does nothing. It's an expression that gets thrown
    // away. Put a breakpoint here, or use console.log(this), and you'll see
    // it's the UserController object:
    //   UserController { userService: UserService { userLoggerService: ..., users: [...] } }
    // i.e. an object whose field was set by the constructor shortcut.
    this;

    // Why does `this` work here?
    // Nest calls the method as  userController.getUser(name)
    // and `this` is the object before the dot.
    //
    // ⚠️ Classic JS trap (good to know):
    //   const fn = userController.getUser;
    //   fn('saim');   // `this` is undefined -> crash "cannot read userService"
    // `this` depends on HOW a function is called, not where it was written.
    // Nest calls it the right way, so you're safe here.

    // EXPERIMENT: `this.requestCount` is on the shared object, so it keeps
    // counting up. A local `let count = 0` here would be 1 every time,
    // because local variables are created fresh for each call.
    this.requestCount++;
    console.log('request number', this.requestCount);

    return this.userService.getUserByName(name);
  }

  // --------------------------------------------------------------------------
  // GET /user/2
  // --------------------------------------------------------------------------
  // '/:id' means "this part of the URL is a variable called id".
  // @Param('id') pulls it out. It's ALWAYS a STRING ("2", not 2), because
  // URLs are text.
  //
  // FIXED (2026-09-18): ParseIntPipe converts it at the edge:
  //   "2"    → 2 (the handler gets a real number)
  //   "1abc" → 400 "Validation failed (numeric string is expected)"
  // Before, the service did parseInt(id), and parseInt("1abc") === 1, so
  // /user/1abc returned user 1. Pipes placed INSIDE @Param() only run for
  // that one argument (notes/07-pipes-validation.md, 3.5).
  @Get('/:id')
  getUserbyId(@Param('id', ParseIntPipe) id: number) {
    return this.userService.getUserById(id);
  }

  // --------------------------------------------------------------------------
  // POST /user        body: { "name": "Ali" }
  // --------------------------------------------------------------------------
  // @Body() = "pass the parsed JSON body as this argument".
  // `: CreateUserDto` is only a TYPE hint here. The value is a plain object
  // { name: "Ali" }, not something made with `new CreateUserDto()`.
  // (See create-user.dto.ts.)
  //
  // UPDATE (Day 4): the global ValidationPipe now runs BEFORE this method.
  // Nest knows which class to validate against because TypeScript saved the
  // param type (`design:paramtypes` = [CreateUserDto]), the same trick DI uses.
  // If validation fails, this method is never called (400 is sent instead).
  // With `transform: true` (main.ts) it's now a real CreateUserDto instance
  // (tested: without that option it was a plain object, `instanceof` false).
  //
  // Whatever a controller method RETURNS, Nest turns into JSON and sends
  // back as the response. You never call res.send() yourself.
  @Post()
  createUser(@Body() createUserDto: CreateUserDto) {
    return this.userService.createUser(createUserDto);
  }

  // --------------------------------------------------------------------------
  // PUT /user/2       body: { "name": "New Name" }
  // --------------------------------------------------------------------------
  // You can combine several parameter decorators. Nest fills each argument
  // from the matching part of the request.
  //
  // FIXED (2026-09-18): UpdateUserDto now uses PartialType, so the client can
  // send only the fields it wants to change ({ "name": "x" } OR { "email": ... }),
  // and the whole DTO goes to the service instead of just `.name`.
  //
  // REST note (coming in notes/08): PUT traditionally means "REPLACE the whole
  // resource", PATCH means "change SOME fields". What this route does is
  // really a PATCH. The official course uses @Patch for this.
  @Put('/:id')
  updateUser(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.userService.updateUser(id, updateUserDto);
  }
}

// ============================================================================
// FULL REQUEST FLOW:  GET /user?name=saim
// ============================================================================
//  1. Express receives the HTTP request.
//  2. Nest finds the route: @Controller('user') + @Get() -> UserController.getUser
//  3. Nest builds the arguments from the decorators: name = req.query.name = "saim"
//  4. Nest calls userController.getUser("saim")        (`this` = userController)
//  5. It calls this.userService.getUserByName("saim")  (`this` = userService)
//  6. That calls this.userLoggerService.log(...)       (`this` = logger)
//  7. The return value travels back up and Nest sends it as JSON.
// ============================================================================
