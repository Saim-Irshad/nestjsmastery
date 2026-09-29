// In Jest's ESM mode (see jest.config.ts) `jest` is not a global, so import it.
import { jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CoffeeService } from './coffee.service';
import { Coffee } from './entity/coffee.entity';
import { Flavor } from './entity/flavor.entity';

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

  // The flavor table helper, faked the same way. findOrCreateFlavor() uses
  // findOne (does this flavor exist?) and create (build a new one in memory).
  const fakeFlavorRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // The generated test only listed CoffeeService, so Nest complained that it
    // couldn't build it: nobody provided the coffee helper.
    // getRepositoryToken(Coffee) is the name that helper is registered under
    // ("CoffeeRepository"), the same name @InjectRepository(Coffee) asks for.
    //
    // ⚠️ FIXED 2026-09-29: this test went red the day flavors became a
    // relation. The service's constructor grew a second argument (the flavor
    // table), this file still provided only the first, and Nest said:
    //   Nest can't resolve dependencies of the CoffeeService (CoffeeRepository, ?)
    //   ... "FlavorRepository" at index [1]
    // A test module has to provide EVERY dependency, exactly like a real
    // module (notes/19-testing.md Part A). The lesson: a spec is code too, and
    // it goes stale when a constructor changes.
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoffeeService,
        { provide: getRepositoryToken(Coffee), useValue: fakeRepo },
        { provide: getRepositoryToken(Flavor), useValue: fakeFlavorRepo },
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

    // ⚠️ Note `flavor: []`, not just the dto. This test was written before
    // flavors became a relation. create() now translates the words the client
    // sent into flavor rows first, and passes `{ ...dto, flavor: rows }`; with
    // no flavors in the body that is an empty array. The test failed with
    //   - Expected  { brand, name }
    //   + Received  { brand, flavor: [], name }
    // which is a test telling the truth about a change, not a bug.
    expect(fakeRepo.create).toHaveBeenCalledWith({ ...dto, flavor: [] }); // memory only
    expect(fakeRepo.save).toHaveBeenCalledWith(dto); // the write
  });

  it('create turns flavor words into rows, reusing one that already exists', async () => {
    // "vanilla" is already in the flavor table; "nutty" is not.
    const vanillaRow = { id: 3, name: 'vanilla' };
    const nuttyRow = { name: 'nutty' }; // built in memory, saved by cascade
    fakeFlavorRepo.findOne
      .mockResolvedValueOnce(vanillaRow as never) // found
      .mockResolvedValueOnce(null as never); // not found
    fakeFlavorRepo.create.mockReturnValue(nuttyRow as never);
    fakeRepo.create.mockImplementation((v: unknown) => v as never);
    fakeRepo.save.mockImplementation((v: unknown) => v as never);

    const dto = { name: 'Latte', brand: 'Sbux', flavor: ['vanilla', 'nutty'] };
    await service.create(dto);

    // The existing row is reused (that is the whole point of a flavor table),
    // and only the missing one is created.
    expect(fakeFlavorRepo.create).toHaveBeenCalledTimes(1);
    expect(fakeFlavorRepo.create).toHaveBeenCalledWith({ name: 'nutty' });
    expect(fakeRepo.create).toHaveBeenCalledWith({
      name: 'Latte',
      brand: 'Sbux',
      flavor: [vanillaRow, nuttyRow],
    });
  });
});
