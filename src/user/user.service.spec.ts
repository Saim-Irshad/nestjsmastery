// In Jest's ESM mode (see jest.config.ts) `jest` is not a global, so import it.
import { jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserLoggerService } from './user.logger.service';
import { UserService } from './user.service';

describe('UserService', () => {
  let service: UserService;

  beforeEach(async () => {
    // UserService's constructor needs a UserLoggerService, so the test module
    // must provide one too (the generated test forgot it → DI error).
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: UserLoggerService, useValue: { log: jest.fn() } }, // silent fake logger
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('createUser stores only name and email, never extra fields', () => {
    // Simulates a body that slipped past validation with an extra field.
    const body = { name: 'hacker', email: 'h@x.com', isAdmin: true } as any;
    const created = service.createUser(body);
    expect(created).toEqual({ id: 4, name: 'hacker', email: 'h@x.com' });
  });

  it('updateUser changes only the fields that were sent', () => {
    const updated = service.updateUser(1, { email: 'saim@x.com' });
    expect(updated).toEqual({ id: 1, name: 'saim', email: 'saim@x.com' });
  });

  it('throws NotFoundException for a missing user', () => {
    expect(() => service.getUserById(999)).toThrow(NotFoundException);
  });
});
