// ============================================================================
// coffee.controller.ts: THE URLS FOR COFFEE
// ============================================================================
// Reads the request, calls the service, returns whatever the service gives
// back. Nest turns that into JSON. No database code here on purpose.
// ============================================================================

import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  ParseIntPipe,
  Delete,
  Query,
} from '@nestjs/common';
import { CoffeeService } from './coffee.service';
import { CreateCoffeeDto } from './dto/create-coffee.dto';
import { UpdateCoffeeDto } from './dto/update-coffee.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

// Every route below starts with /coffee
@Controller('coffee')
export class CoffeeController {
  // Nest creates the service and hands it over (same as UserController).
  constructor(private readonly coffeeService: CoffeeService) {}

  // GET /coffee?limit=10&offset=0
  //
  // @Query() with no name hands over the WHOLE query string as one object,
  // and because it's typed as PaginationQueryDto, the same checker that
  // guards request bodies also guards the URL: ?limit=abc → 400, and the text
  // "10" is turned into the number 10 before it reaches us.
  //
  // @Query('name') (one name, like in the user controller) gives a single
  // value instead, with no class and therefore no checks.
  @Get()
  findAll(@Query() paginationQuery: PaginationQueryDto) {
    return this.coffeeService.findAll(paginationQuery);
  }

  // GET /coffee/:id
  @Get('/:id')
  findById(@Param('id', ParseIntPipe) id: number) {
    return this.coffeeService.findById(id);
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

  @Patch('/:id')
  updateById(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateCoffeeDto: UpdateCoffeeDto,
  ) {
    return this.coffeeService.updateById(id, updateCoffeeDto);
  }

  @Delete('/:id')
  deleteById(@Param('id', ParseIntPipe) id: number) {
    return this.coffeeService.deleteById(id);
  }
}
