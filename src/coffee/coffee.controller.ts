// ============================================================================
// coffee.controller.ts: THE URLS FOR COFFEE
// ============================================================================
// Reads the request, calls the service, returns whatever the service gives
// back. Nest turns that into JSON. No database code here on purpose.
// ============================================================================

import { Controller, Get, Post, Body } from '@nestjs/common';
import { CoffeeService } from './coffee.service';
import { CreateCoffeeDto } from './dto/create-coffee.dto';

// Every route below starts with /coffee
@Controller('coffee')
export class CoffeeController {
  // Nest creates the service and hands it over (same as UserController).
  constructor(private readonly coffeeService: CoffeeService) {}

  // GET /coffee
  @Get()
  findAll() {
    return this.coffeeService.findAll();
  }

  // POST /coffee   body: { "name": "Latte", "brand": "Sbux", "flavor": ["vanilla"] }
  //
  // @Body() hands over the parsed JSON. Before this method runs, the checker
  // in main.ts has already:
  //   - rejected the request if name/brand are missing or not text (400)
  //   - rejected any extra field that isn't in CreateCoffeeDto
  // So by the time we get here, the body is known-good.
  @Post()
  create(@Body() createCoffeeDto: CreateCoffeeDto) {
    return this.coffeeService.create(createCoffeeDto);
  }

  // TO DO (the service already has these, the URLs are missing):
  //   @Get('/:id')    → findById(id)      with ParseIntPipe, like the user routes
  //   @Patch('/:id')  → updateById(id, dto)
  //   @Delete('/:id') → deleteById(id)
  // Note PATCH, not PUT: we're changing some fields, not replacing the coffee.
}
