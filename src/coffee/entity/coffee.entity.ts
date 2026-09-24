// ============================================================================
// coffee.entity.ts: THIS CLASS DESCRIBES A TABLE IN POSTGRES
// ============================================================================
// One class  = one table ("coffee")
// One object = one row
// One property = one column
//
// The decorators are notes stuck on the class. TypeORM reads them at startup
// and, because main app config has `synchronize: true`, it creates or changes
// the real table so it matches this file.
//
// The coffee table itself:
//   id     | integer           | not null | default nextval('coffee_id_seq')
//   name   | character varying | not null |
//   brand  | character varying | not null |
//
// Flavors are NOT a column here anymore. They live in their own table, joined
// through a third table of pairs. See the long comment further down.
//
// Notes: notes/09-database-docker-typeorm.md (Part B) · notes/10-relations.md
// ============================================================================

import {
  Column,
  Entity,
  JoinTable,
  PrimaryGeneratedColumn,
  ManyToMany,
} from 'typeorm';
import { Flavor } from './flavor.entity';

// @Entity() = "this class is a table".
// Table name defaults to the class name in lowercase → "coffee".
// Want a different name: @Entity('coffees')
@Entity()
export class Coffee {
  // The id column. Postgres fills it in itself: it keeps a counter for this
  // table and hands out 1, 2, 3... so we never set the id when creating.
  @PrimaryGeneratedColumn()
  id: number;

  // A plain column. TypeORM picks the database type from the TypeScript type:
  //   string → varchar, number → integer, boolean → boolean, Date → timestamp
  // Columns are NOT NULL unless you say otherwise, so a coffee must have a name.
  @Column()
  name: string;

  @Column()
  brand: string;

  // --------------------------------------------------------------------------
  // FLAVORS: NOT A COLUMN ANYMORE (course lesson26)
  // --------------------------------------------------------------------------
  // This used to be:  @Column({ type: 'json' }) flavor?: string[]
  // i.e. the words sat inside the coffee row as ["vanilla","nutty"].
  //
  // Now flavors are real rows in their own table, and THREE tables are
  // involved, because a coffee has many flavors AND a flavor belongs to many
  // coffees. A box in a row can only hold one value, so the connections get
  // their own table:
  //
  //   coffee                 coffee_flavors            flavor
  //    id | name              coffeeId | flavorId       id | name
  //    1  | Latte      ──┐       1     |    3    ┌──►   3  | vanilla
  //    2  | Cappuccino   │       1     |    5    │      5  | nutty
  //                      └──►    2     |    3    ┘
  //
  // Each row in the middle = one connection. Latte has two flavors (two rows),
  // vanilla is used by two coffees (two rows), and the word "vanilla" itself
  // is stored once.
  //
  // @JoinTable() = "this side owns the link table". Put it on ONE side only
  // (Flavor has the matching @ManyToMany without it). Without the { name: ... }
  // option TypeORM invents a name from the pieces: coffee_flavor_flavor.
  //
  // cascade: true = when a coffee is saved, also insert any brand-new flavor
  // rows attached to it. That's what lets the service hand over a flavor it
  // just made up from a name.
  //
  // This property holds ROWS ({ id, name }), not words. The request body still
  // sends words, so the service translates: see findOrCreateFlavor().
  //
  // Nothing here is fetched automatically. Ask for it per query:
  //   find({ relations: { flavor: true } })
  @JoinTable({ name: 'coffee_flavors' })
  @ManyToMany((type) => Flavor, (flavor) => flavor.coffee, { cascade: true })
  flavor?: Flavor[];
}

// ⚠️ This class is the DATABASE shape, not the shape clients may send.
// The request body has its own class (dto/create-coffee.dto.ts) with its own
// rules. See notes/07-pipes-validation.md §6.1 for why we keep them apart.
