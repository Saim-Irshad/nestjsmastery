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

  // Start the HTTP server. `??` means "use the right side if the left side
  // is null/undefined", so it uses PORT from the environment or falls back to 3000.
  await app.listen(process.env.PORT ?? 3000);
}

// `void` just says "I know this returns a Promise and I'm not awaiting it on
// purpose". It keeps the linter quiet.
void bootstrap();
