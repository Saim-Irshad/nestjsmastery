// In Jest's ESM mode (see jest.config.ts) `jest` is not a global, so import it.
import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from './user.service';

describe('UserController', () => {
  let controller: UserController;

  // A FAKE UserService. The controller only needs "something with these
  // methods". This is DI paying off (notes/03): we swap the real service for a
  // fake one without touching the controller's code.
  const fakeUserService = {
    getUserByName: jest.fn(),
    getUserById: jest.fn(),
    createUser: jest.fn(),
    updateUser: jest.fn(),
  };

  beforeEach(async () => {
    // The generated test only listed the controller, so Nest failed with
    // "can't resolve dependencies of UserController (?)": nobody provided
    // UserService. `useValue` says "when someone asks for UserService, give them this".
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [{ provide: UserService, useValue: fakeUserService }],
    }).compile();

    controller = module.get<UserController>(UserController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes the numeric id and the whole DTO to the service on update', () => {
    controller.updateUser(1, { name: 'saim2' });
    expect(fakeUserService.updateUser).toHaveBeenCalledWith(1, {
      name: 'saim2',
    });
  });
});
