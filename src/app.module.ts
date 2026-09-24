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
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoffeeModule } from './coffee/coffee.module';

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
  imports: [
    UserModule,
    // ------------------------------------------------------------------------
    // OPEN THE DATABASE CONNECTION (once, when the app starts)
    // ------------------------------------------------------------------------
    // Written by hand this would be one line near the top of your app:
    //   const db = await connectToPostgres({ host, port, user, password })
    // Nest does it here instead, so any feature can use the same connection.
    //
    // It doesn't open one connection per request either. It keeps a small set
    // of open connections (about 10) and lends them out, because opening a new
    // one for every request would be slow.
    //
    // This runs ONCE, in this file only. The log line
    // "TypeOrmModule dependencies initialized" means it connected.
    TypeOrmModule.forRoot({
      type: 'postgres', // which database software
      host: 'localhost', // our Mac: the container's port is mapped to it
      port: 5432,
      username: 'postgres', // the default user inside the postgres image
      password: 'pass123', // matches POSTGRES_PASSWORD in docker-compose.yaml
      database: 'postgres', // the default database created by the image

      // Pick up every entity class that a feature module registered with
      // forFeature([...]). Without it, you'd have to list them all here.
      autoLoadEntities: true,

      // At startup, compare the entity classes with the real tables and change
      // the database so they match. That's how the "coffee" table appeared:
      // we never wrote CREATE TABLE.
      //
      // ⚠️ LOCAL DEVELOPMENT ONLY. It can delete a column (and its data) to
      // make the table match a class. Rename `brand` in the entity and the
      // whole brand column can be dropped. Real projects turn this off and use
      // migration files instead: small, reviewed steps, committed to git
      // (course lesson32).
      synchronize: true,
    }),
    CoffeeModule,
  ],

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
