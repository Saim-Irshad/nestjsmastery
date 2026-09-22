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
// The table Postgres actually built from this (checked with `\d coffee`):
//   id     | integer           | not null | default nextval('coffee_id_seq')
//   name   | character varying | not null |
//   brand  | character varying | not null |
//   flavor | json              |          |
//
// Notes: notes/09-database-docker-typeorm.md (Part B)
// ============================================================================

import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

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

  // Here we say the type ourselves, because "an array of strings" has no
  // obvious database type. `json` stores it as JSON text: ["vanilla","nutty"].
  // nullable: true → this column may be empty.
  //
  // In course lesson23 this changes: flavors become their own table and rows,
  // linked to coffee, instead of a blob of JSON. Then searching "all coffees
  // with vanilla" becomes a normal query instead of digging inside JSON.
  @Column({ type: 'json', nullable: true })
  flavor?: string[];
}

// ⚠️ This class is the DATABASE shape, not the shape clients may send.
// The request body has its own class (dto/create-coffee.dto.ts) with its own
// rules. See notes/07-pipes-validation.md §6.1 for why we keep them apart.
