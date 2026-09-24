// ============================================================================
// flavor.entity.ts: THE "flavor" TABLE
// ============================================================================
// Each flavor word is stored here EXACTLY ONCE:
//
//   flavor
//    id | name
//    3  | vanilla      ← used by Latte, Cappuccino, and anything else
//    5  | nutty
//
// Before this, flavors lived inside the coffee row as JSON: ["vanilla"].
// That copied the word into every coffee, so "which coffees have vanilla?"
// meant opening every JSON blob, and a typo could never be fixed in one place.
//
// Notes: notes/10-relations.md
// ============================================================================

import { Column, Entity, ManyToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Coffee } from './coffee.entity';

@Entity()
export class Flavor {
  // Postgres hands out the numbers (1, 2, 3...).
  // It was @PrimaryColumn() first, which means "I'll supply the id myself".
  // That doesn't work here: the service creates flavors from a name alone
  // (findOrCreateFlavor), and it has no id to give.
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  // The other half of the link. Coffee has the same line pointing back here.
  //
  // Two things this does NOT do: it doesn't add a column to this table, and it
  // doesn't fetch anything by itself. It's the map that tells TypeORM how to
  // find the connected rows when you ask for them
  // (`relations: { coffee: true }`).
  //
  // Why `(type) => Coffee` instead of just `Coffee`? These two files import
  // each other. When one is still loading, the other's class isn't ready yet,
  // so we hand over a function TypeORM can call later, once both exist.
  //
  // Note: no @JoinTable() here. That decorator goes on ONE side only, and
  // Coffee has it. It marks which side owns the link table.
  @ManyToMany((type) => Coffee, (coffee) => coffee.flavor)
  coffee: Coffee[];
}
