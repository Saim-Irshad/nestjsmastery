// ============================================================================
// coffee.module.ts: THE COFFEE FEATURE, IN ONE BOX
// ============================================================================

import { Module } from '@nestjs/common';
import { CoffeeController } from './coffee.controller';
import { CoffeeService } from './coffee.service';
import { Coffee } from './entity/coffee.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  // "Build the helper object for the coffee table and make it available in
  // this module." It does NOT open a connection; the connection was opened
  // once in app.module.ts. Here we only get the table helper that uses it.
  //
  // Leave this line out and the app won't start:
  //   "Nest can't resolve dependencies of the CoffeeService (?)"
  // because nothing would have created the thing CoffeeService asks for.
  //
  // Another module that needs coffee data adds this same line; the helper is
  // cheap to make, and the connection stays shared.
  imports: [TypeOrmModule.forFeature([Coffee])],

  // The URLs this module answers.
  controllers: [CoffeeController],

  // The workers that live here. Not exported, so no other module can inject
  // CoffeeService yet. Add `exports: [CoffeeService]` when one needs to.
  providers: [CoffeeService],
})
export class CoffeeModule {}
