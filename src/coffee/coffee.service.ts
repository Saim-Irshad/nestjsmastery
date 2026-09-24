// ============================================================================
// coffee.service.ts: THE COFFEE LOGIC. TALKS TO THE DATABASE.
// ============================================================================
// Before this, UserService kept an array in memory that vanished on restart.
// Here the data lives in Postgres (in the Docker container), so it survives.
//
// Notes: notes/09-database-docker-typeorm.md (Part B)
// ============================================================================

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Coffee } from './entity/coffee.entity';
import { CreateCoffeeDto } from './dto/create-coffee.dto';
import { UpdateCoffeeDto } from './dto/update-coffee.dto';
import { NotFoundException } from '@nestjs/common';
import { Flavor } from './entity/flavor.entity';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@Injectable()
export class CoffeeService {
  // --------------------------------------------------------------------------
  // WHAT THIS CONSTRUCTOR IS ASKING FOR
  // --------------------------------------------------------------------------
  // `coffeeRepositery` is a helper object: a bag of ready-made functions for
  // ONE table (find, save, delete, update). Written by hand it would be:
  //
  //   const coffeeTable = {
  //     find: ()  => db.query('SELECT * FROM coffee'),
  //     save: (c) => db.query('INSERT INTO coffee (name, brand) VALUES ($1,$2)', [c.name, c.brand]),
  //   };
  //
  // Where does it come from?
  //   app.module.ts   TypeOrmModule.forRoot({...})      → opens the connection once
  //   coffee.module   TypeOrmModule.forFeature([Coffee]) → builds this coffee helper
  //   here            @InjectRepository(Coffee)          → hand me the coffee one
  //
  // Why write @InjectRepository(Coffee) when the type already says
  // Repository<Coffee>? Because <Coffee> disappears when TypeScript is
  // compiled to JavaScript. The running code would only see "a repository"
  // and not know which table, so we say it again in a way that survives.
  // --------------------------------------------------------------------------
  constructor(
    @InjectRepository(Coffee)
    private readonly coffeeRepositery: Repository<Coffee>,

    @InjectRepository(Flavor)
    private readonly flavorRepositery: Repository<Flavor>,
  ) {}

  // --------------------------------------------------------------------------
  // THE TRANSLATOR: one word → one flavor row
  // --------------------------------------------------------------------------
  // The client sends words:            ["vanilla", "nutty"]
  // A coffee now holds rows:           [{ id: 3, name: "vanilla" }, ...]
  // Something has to turn one into the other. This is it.
  //
  // "vanilla" already in the flavor table → reuse that exact row. That's the
  // whole point of a separate flavor table: the word is stored ONCE and shared
  // by every coffee, so renaming it fixes every coffee at the same time.
  //
  // Why is this in the coffee service? Because "create a coffee" is the job,
  // and looking up its flavors is part of doing that job. If flavors ever get
  // their own routes (list them, rename one), they get their own service and
  // this moves there.
  //
  // `private` = only this class uses it. It's a helper, not part of the API.
  private async findOrCreateFlavor(name: string): Promise<Flavor> {
    const existingFlavor = await this.flavorRepositery.findOne({
      where: { name },
    });
    if (existingFlavor) {
      return existingFlavor; // found → reuse that row
    }

    // Not there yet. Build one in memory ONLY (create never writes).
    // It gets inserted when the coffee is saved, because the relation in
    // coffee.entity.ts has `cascade: true`. Without that option, saving the
    // coffee would fail: "you're attaching a flavor that doesn't exist".
    return this.flavorRepositery.create({ name });
  }

  // Every method here is `async` because talking to the database takes time
  // (it goes over the network to the container). `await` lets Node serve other
  // requests while we wait. See notes/04.
  async findAll(paginationQuery: PaginationQueryDto) {
    // `relations: { flavor: true }` = "also bring each coffee's flavors".
    // Without it you get the coffees alone, with no flavor field at all: the
    // flavors live in another table, and fetching them is extra work, so
    // TypeORM only does it when asked.
    //
    // Behind the scenes it stops being one simple SELECT. It now has to walk
    // coffee → coffee_flavors → flavor and stitch the rows back together
    // (a JOIN). That's why you ask per query instead of getting it always.
    // skip/take become LIMIT and OFFSET in the SQL:
    //   SELECT ... FROM coffee LIMIT 10 OFFSET 20
    //   skip = how many rows to jump over, take = how many to return
    //
    // ⚠️ If the client sends neither, both are undefined and this goes back to
    // "give me the whole table". A real API applies a default (say 20) and a
    // maximum, so nobody can ask for a million rows.
    //
    // ⚠️ OFFSET has a hidden cost: to skip 100,000 rows the database still
    // walks past them. Deep pages get slower and slower. Feeds and infinite
    // scroll use "give me the 20 after id X" instead (cursor paging), which
    // stays fast at any depth.
    return await this.coffeeRepositery.find({
      relations: { flavor: true },
      skip: paginationQuery.offset,
      take: paginationQuery.limit,
    });
  }

  async findById(id: number) {
    // Runs: SELECT ... FROM coffee WHERE id = $1 LIMIT 1
    // The $1 keeps the value separate from the SQL text, so a value like
    // "1; DROP TABLE coffee" is treated as text, never as a command.
    const coffee = await this.coffeeRepositery.findOne({ where: { id } });

    // findOne does NOT throw when nothing matches, it returns null.
    // So we throw ourselves, and the built-in error layer turns it into a 404.
    if (!coffee) {
      throw new NotFoundException(`Coffee #${id} not found`);
    }
    return coffee;
  }

  async deleteById(id: number) {
    const coffee = await this.coffeeRepositery.findOne({ where: { id } });
    if (!coffee) {
      throw new NotFoundException(`Coffee #${id} not found`);
    }
    // Runs: DELETE FROM coffee WHERE id = $1
    // Careful: this returns { raw: [], affected: 1 }, not the coffee. Many APIs
    // return the deleted item (`return coffee`) or send back nothing at all.
    return await this.coffeeRepositery.delete(id);
  }

  async updateById(id: number, updateCoffeeDto: UpdateCoffeeDto) {
    // Only translate if the client actually sent flavors. Three different
    // meanings that must stay apart on an update:
    //   field missing → undefined → leave the coffee's flavors alone
    //   []            → []        → remove all its flavors
    //   ["vanilla"]   → [row]     → replace them with this list
    const flavors = updateCoffeeDto.flavor
      ? await Promise.all(
          updateCoffeeDto.flavor.map((name) => this.findOrCreateFlavor(name)),
        )
      : undefined;
    // preload = "fetch row #id, then paste these changes on top of it".
    // It runs a SELECT and gives back the full coffee with the new values,
    // or undefined if that id doesn't exist. Nothing is written yet.
    const coffee = await this.coffeeRepositery.preload({
      ...updateCoffeeDto, // everything the client sent (flavor still = words)
      id, // which row to load
      flavor: flavors, // ...but swap the words for the real rows
    });

    if (!coffee) {
      throw new NotFoundException(`Coffee #${id} not found`);
    }

    // ⚠️ TO FIX (practice task): `update()` returns { affected: 1 }, so the
    // client gets {"generatedMaps":[],"raw":[],"affected":1} instead of the
    // coffee. We already hold the full row, so `save(coffee)` is the right
    // call: it writes and returns the updated coffee. It will also matter in
    // lesson28, where save() handles linked rows and update() doesn't.
    return await this.coffeeRepositery.save(coffee);
  }

  async create(createCoffeeDto: CreateCoffeeDto) {
    // Turn every word into a flavor row.
    //
    // `.map` with an async function does NOT give you flavors. It gives you a
    // list of promises, one unfinished database trip per name:
    //   ["vanilla","nutty"] → [Promise, Promise]
    // `Promise.all` waits for all of them and hands back the results in order:
    //   [Promise, Promise] → [{id:3,...}, {id:5,...}]
    //
    // Why not a plain loop with await inside? A loop asks, waits, asks, waits:
    // 3 flavors × 5ms = 15ms. This sends all the questions at once and waits
    // for the slowest: 5ms. Harmless with 3 items, painful with 50, and
    // "await inside a loop" is one of the most common causes of slow endpoints.
    // If any one of them fails, the whole thing throws, which is what we want:
    // no coffee saved with half its flavors.
    //
    // `?? []` covers the client not sending flavors at all.
    const flavors = await Promise.all(
      (createCoffeeDto.flavor ?? []).map((name) =>
        this.findOrCreateFlavor(name),
      ),
    );

    // "Everything the client sent, except swap the words for the rows."
    // Passing `createCoffeeDto` straight in is what TypeScript was rejecting:
    //   DTO says    flavor?: string[]     (what a client may send)
    //   Coffee says flavor?: Flavor[]     (what the database holds)
    // create() still only builds an object in memory; save() writes.
    const coffeeEntity = this.coffeeRepositery.create({
      ...createCoffeeDto,
      flavor: flavors,
    });

    // save() is the one that writes:
    //   INSERT INTO coffee (name, brand, flavor) VALUES ($1,$2,$3) RETURNING id
    // It decides INSERT vs UPDATE by whether the object already has an id.
    // It returns the coffee WITH the id Postgres generated.
    return await this.coffeeRepositery.save(coffeeEntity);
  }
}
