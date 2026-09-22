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
  ) {}

  // Every method here is `async` because talking to the database takes time
  // (it goes over the network to the container). `await` lets Node serve other
  // requests while we wait. See notes/04.
  async findAll() {
    // Runs: SELECT id, name, brand, flavor FROM coffee
    //
    // ⚠️ No limit. With 3 rows that's fine; with 2 million it loads them all
    // into memory and freezes everyone (course lesson26 adds pagination:
    // this.coffeeRepositery.find({ take: limit, skip: offset })).
    return await this.coffeeRepositery.find();
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
    // preload = "fetch row #id, then paste these changes on top of it".
    // It runs a SELECT and gives back the full coffee with the new values,
    // or undefined if that id doesn't exist. Nothing is written yet.
    const coffee = await this.coffeeRepositery.preload({
      id: +id,
      ...updateCoffeeDto,
    });
    if (!coffee) {
      throw new NotFoundException(`Coffee #${id} not found`);
    }

    // ⚠️ TO FIX (practice task): `update()` returns { affected: 1 }, so the
    // client gets {"generatedMaps":[],"raw":[],"affected":1} instead of the
    // coffee. We already hold the full row, so `save(coffee)` is the right
    // call: it writes and returns the updated coffee. It will also matter in
    // lesson25, where save() handles linked rows and update() doesn't.
    return await this.coffeeRepositery.update(id, coffee);
  }

  async create(createCoffeeDto: CreateCoffeeDto) {
    // create() does NOT touch the database. It just builds a Coffee object in
    // memory from the plain body (so defaults and hooks apply).
    const coffeeEntity = this.coffeeRepositery.create(createCoffeeDto);

    // save() is the one that writes:
    //   INSERT INTO coffee (name, brand, flavor) VALUES ($1,$2,$3) RETURNING id
    // It decides INSERT vs UPDATE by whether the object already has an id.
    // It returns the coffee WITH the id Postgres generated.
    return await this.coffeeRepositery.save(coffeeEntity);
  }
}
