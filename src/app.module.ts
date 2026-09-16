// ============================================================================
// app.module.ts: THE ROOT MODULE (the "table of contents" of the app)
// ============================================================================
// A module is how you tell Nest which pieces exist and how they're grouped.
// It holds no logic of its own. It's a list.
// ============================================================================

import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './user/user.module';

// ---------------------------------------------------------------------------
// WHAT IS `@Module(...)`? (DECORATORS)
// ---------------------------------------------------------------------------
// A decorator (the `@something` above a class/method/param) is just a
// FUNCTION that runs once, when the class is defined. It receives the class
// and usually attaches a hidden note (called "metadata") to it.
//
// Roughly what `@Module({...})` does:
//
//   function Module(options) {
//     return function (targetClass) {
//       Reflect.defineMetadata('imports',     options.imports,     targetClass);
//       Reflect.defineMetadata('controllers', options.controllers, targetClass);
//       Reflect.defineMetadata('providers',   options.providers,   targetClass);
//     };
//   }
//
// It does NOT change how the class behaves. It sticks a label on it.
// Later NestFactory reads those labels to know what to build.
//
// Functional comparison: it's like writing
//   const AppModule = { imports: [...], controllers: [...], providers: [...] };
// Nest uses a class plus a decorator instead of a plain object.
// ---------------------------------------------------------------------------
@Module({
  // imports: other modules whose pieces should also be loaded.
  // Because UserModule is here, /user routes exist.
  imports: [UserModule],

  // controllers: classes that handle HTTP requests (routes).
  // Nest will `new` them and connect their methods to URLs.
  controllers: [AppController],

  // providers: classes Nest should create and be able to INJECT into
  // constructors (services, loggers, repositories...).
  // If a class isn't listed here, Nest doesn't know how to create it, and
  // you get "Nest can't resolve dependencies of ...".
  providers: [AppService],
})
// The class is EMPTY on purpose. It only exists so the decorator has
// something to attach its metadata to.
export class AppModule {}
