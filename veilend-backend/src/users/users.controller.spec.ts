import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Platform } from '@prisma/client';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { CreatePushTokenDto } from './dto/create-push-token.dto';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';

function reqFor(userId: string | undefined): AuthenticatedRequest {
  return {
    user: {
      userId,
      walletAddress: 'G...',
      sessionId: 's',
      expiresAt: new Date(),
    },
  } as unknown as AuthenticatedRequest;
}

describe('UsersController', () => {
  let controller: UsersController;

  const mockUsersService = {
    upsertPushToken: jest.fn(),
    deletePushToken: jest.fn(),
    getNotificationSettings: jest.fn(),
    updateNotificationSettings: jest.fn(),
    setE2eeKey: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('rejects a malformed Expo push token before it would reach the service', async () => {
    const dto = plainToInstance(CreatePushTokenDto, {
      token: 'not-a-real-token',
      platform: Platform.IOS,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('delegates push token registration to the service', async () => {
    mockUsersService.upsertPushToken.mockResolvedValue({
      id: 'token-1',
      platform: Platform.IOS,
      locale: null,
      createdAt: new Date(),
    });

    await controller.registerPushToken(
      { token: 'ExponentPushToken[abc]', platform: Platform.IOS },
      reqFor('user-1'),
    );

    expect(mockUsersService.upsertPushToken).toHaveBeenCalledWith('user-1', {
      token: 'ExponentPushToken[abc]',
      platform: Platform.IOS,
    });
  });

  it('throws UnauthorizedException when the request has no authenticated user id', async () => {
    await expect(
      controller.registerPushToken(
        { token: 'ExponentPushToken[abc]', platform: Platform.IOS },
        reqFor(undefined),
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(mockUsersService.upsertPushToken).not.toHaveBeenCalled();
  });

  it('delegates push token removal to the service, scoped to the caller', async () => {
    mockUsersService.deletePushToken.mockResolvedValue(undefined);

    const result = await controller.removePushToken(
      'token-1',
      reqFor('user-1'),
    );

    expect(mockUsersService.deletePushToken).toHaveBeenCalledWith(
      'user-1',
      'token-1',
    );
    expect(result).toEqual({ deleted: true });
  });

  it('delegates notification settings patch to the service', async () => {
    mockUsersService.updateNotificationSettings.mockResolvedValue({
      liquidationRisk: true,
      liquidationOpportunity: true,
      generalAnnouncements: true,
      marketing: true,
      security: true,
      updatedAt: new Date(),
    });

    await controller.updateNotificationSettings(
      { marketing: true },
      reqFor('user-1'),
    );

    expect(mockUsersService.updateNotificationSettings).toHaveBeenCalledWith(
      'user-1',
      { marketing: true },
    );
  });
});
