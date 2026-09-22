// In Jest's ESM mode (see jest.config.ts) `jest` is not a global, so import it.
import { jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CoffeeService } from './coffee.service';
import { Coffee } from './entity/coffee.entity';

describe('CoffeeService', () => {
  let service: CoffeeService;

  // A FAKE table helper. No database, no Docker: the test just decides what
  // "the database" answers. That's only possible because the service asks for
  // the helper instead of creating one itself.
  const fakeRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    preload: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // The generated test only listed CoffeeService, so Nest complained that it
    // couldn't build it: nobody provided the coffee helper.
    // getRepositoryToken(Coffee) is the name that helper is registered under
    // ("CoffeeRepository"), the same name @InjectRepository(Coffee) asks for.
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoffeeService,
        { provide: getRepositoryToken(Coffee), useValue: fakeRepo },
      ],
    }).compile();

    service = module.get<CoffeeService>(CoffeeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('findById returns the coffee when it exists', async () => {
    const coffee = { id: 1, name: 'Latte', brand: 'Sbux' };
    fakeRepo.findOne.mockResolvedValue(coffee as never);

    await expect(service.findById(1)).resolves.toEqual(coffee);
    expect(fakeRepo.findOne).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('findById throws 404 when the row is missing', async () => {
    // findOne gives back null instead of throwing, which is why the service
    // has to check and throw itself.
    fakeRepo.findOne.mockResolvedValue(null as never);

    await expect(service.findById(999)).rejects.toThrow(NotFoundException);
  });

  it('create builds the object first, then saves it', async () => {
    const dto = { name: 'Latte', brand: 'Sbux' };
    fakeRepo.create.mockReturnValue(dto as never);
    fakeRepo.save.mockResolvedValue({ id: 1, ...dto } as never);

    await expect(service.create(dto)).resolves.toEqual({ id: 1, ...dto });
    expect(fakeRepo.create).toHaveBeenCalledWith(dto); // memory only
    expect(fakeRepo.save).toHaveBeenCalledWith(dto); // the write
  });
});
