// ============================================================================
// main.ts: THE ENTRY POINT (the first file that runs)
// ============================================================================
// `pnpm start:dev` compiles TypeScript to JavaScript and runs dist/main.js.
// Everything starts here.
//
// So far this is a plain function, no classes. Classes show up once Nest
// takes over.
// ============================================================================

// NestFactory is an object Nest provides. Its job is to BUILD your app.
import { NestFactory } from '@nestjs/core';

// AppModule is a CLASS, but we do NOT call `new AppModule()`.
// We pass the class itself to Nest. A class is just a value in JS
// (it's really a function), so it can be passed around like any variable.
import { AppModule } from './app.module';
import { TransformInterceptor } from './utils/transform.interceptor';

import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  // What happens inside NestFactory.create(AppModule):
  //
  //   1. Read the @Module({...}) info attached to AppModule
  //      (imports, controllers, providers).
  //   2. Follow `imports` to other modules (UserModule) and read theirs too.
  //   3. For every class listed, look at its constructor to see what it needs.
  //   4. Call `new` on each class in the right order, dependencies first:
  //        const logger      = new UserLoggerService();
  //        const userService = new UserService(logger);
  //        const userCtrl    = new UserController(userService);
  //        ...same for AppService / AppController
  //   5. Read @Get/@Post etc. on controller methods and register URL routes
  //      in Express (the HTTP server underneath).
  //
  // `app` is the finished application object.
  const app = await NestFactory.create(AppModule);

  // --------------------------------------------------------------------------
  // GLOBAL VALIDATION PIPE (notes/07-pipes-validation.md)
  // --------------------------------------------------------------------------
  // Runs on EVERY route, right before the controller method, for every
  // argument (@Body, @Param, @Query). For a @Body() typed as CreateUserDto it:
  //   1. turns the plain JSON into a CreateUserDto instance (class-transformer)
  //   2. runs the @IsString/@IsEmail/... decorators on it (class-validator)
  //   3. any rule fails → throws BadRequestException → 400 with a list of messages
  //
  // ⚠️ SECURITY (tested 2026-09-18): with NO options, unknown fields pass
  // straight through. POST { name, email, isAdmin: true } → 201, and isAdmin
  // got SAVED (because the service spreads ...dto). Real APIs use:
  //   new ValidationPipe({
  //     whitelist: true,             // strip fields that have no decorator in the DTO
  //     forbidNonWhitelisted: true,  // ...or reject the request: "property isAdmin should not exist"
  //     transform: true,             // give the handler a real DTO instance (and convert "5" → 5 for typed params)
  //   })
  //
  // `new` here is fine: ValidationPipe needs no injected dependencies.
  app.useGlobalPipes(new ValidationPipe());

  // --------------------------------------------------------------------------
  // GLOBAL RESPONSE WRAPPER (notes/06-interceptors.md)
  // --------------------------------------------------------------------------
  // Every SUCCESSFUL response becomes { statusCode, data, success: true }.
  // Errors (404, validation 400s) skip it and keep Nest's default shape.
  // We call `new` ourselves, so DI can't inject anything into it; if it ever
  // needs Reflector/Logger, register it with APP_INTERCEPTOR in a module instead.
  app.useGlobalInterceptors(new TransformInterceptor());

  // Start the HTTP server. `??` means "use the right side if the left side
  // is null/undefined", so it uses PORT from the environment or falls back to 3000.
  await app.listen(process.env.PORT ?? 3000);
}

// `void` just says "I know this returns a Promise and I'm not awaiting it on
// purpose". It keeps the linter quiet.
void bootstrap();
