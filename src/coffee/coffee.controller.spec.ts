// In Jest's ESM mode (see jest.config.ts) `jest` is not a global, so import it.
import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { CoffeeController } from './coffee.controller';
import { CoffeeService } from './coffee.service';

describe('CoffeeController', () => {
  let controller: CoffeeController;

  // A fake service. The controller's only job is to pass things along, so the
  // test checks exactly that and nothing else.
  const fakeCoffeeService = {
    findAll: jest.fn(),
    create: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CoffeeController],
      providers: [{ provide: CoffeeService, useValue: fakeCoffeeService }],
    }).compile();

    controller = module.get<CoffeeController>(CoffeeController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('hands the body to the service on create', () => {
    const dto = { name: 'Latte', brand: 'Sbux' };
    controller.create(dto);
    expect(fakeCoffeeService.create).toHaveBeenCalledWith(dto);
  });
});
