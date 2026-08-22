import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { NotificationKind } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import {
  ExpoPushService,
  EncryptedPayload,
  PushMessage,
  SendResult,
} from './expo-push.service';
import { PrismaService } from '../prisma/prisma.service';

const BASE_SETTINGS = {
  userId: 'user-1',
  liquidationRisk: true,
  liquidationOpportunity: true,
  generalAnnouncements: true,
  marketing: false,
  security: true,
  lastLiquidationPushAt: null as Date | null,
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

interface MockPrismaService {
  withRepeatableRead: jest.Mock;
  userNotification: {
    create: jest.Mock;
    update: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
  };
  notificationSettings: {
    upsert: jest.Mock;
    update: jest.Mock;
  };
  pushToken: {
    findMany: jest.Mock;
    deleteMany: jest.Mock;
  };
  userE2eePublicKey: {
    findUnique: jest.Mock;
  };
}

describe('NotificationsService', () => {
  let service: NotificationsService;

  const mockPrismaService: MockPrismaService = {
    withRepeatableRead: jest.fn(
      async (fn: (db: MockPrismaService) => Promise<unknown>) =>
        fn(mockPrismaService),
    ),
    userNotification: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    notificationSettings: {
      upsert: jest.fn(),
      update: jest.fn(),
    },
    pushToken: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    userE2eePublicKey: {
      findUnique: jest.fn(),
    },
  };

  const mockExpoPushService: {
    send: jest.Mock<Promise<SendResult>, [string[], PushMessage]>;
    encryptForUser: jest.Mock<
      EncryptedPayload,
      [string, Record<string, unknown>]
    >;
  } = {
    send: jest.fn<Promise<SendResult>, [string[], PushMessage]>(),
    encryptForUser: jest.fn<
      EncryptedPayload,
      [string, Record<string, unknown>]
    >(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ExpoPushService, useValue: mockExpoPushService },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    jest.clearAllMocks();

    mockPrismaService.notificationSettings.upsert.mockResolvedValue({
      ...BASE_SETTINGS,
    });
    mockPrismaService.userNotification.create.mockResolvedValue({
      id: 'notif-1',
    });
    mockPrismaService.pushToken.findMany.mockResolvedValue([
      { id: 'pt-1', userId: 'user-1', token: 'ExponentPushToken[abc]' },
    ]);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('always writes the in-app notification row, even when the channel is disabled', async () => {
    mockPrismaService.notificationSettings.upsert.mockResolvedValue({
      ...BASE_SETTINGS,
      generalAnnouncements: false,
    });

    await service.notifyUser('user-1', NotificationKind.GENERAL_ANNOUNCEMENT, {
      title: 'Update',
      body: 'Something happened',
    });

    expect(mockPrismaService.userNotification.create).toHaveBeenCalled();
    expect(mockExpoPushService.send).not.toHaveBeenCalled();
  });

  it('rate-limits a second liquidation push within the 1-hour cooldown', async () => {
    mockPrismaService.notificationSettings.upsert.mockResolvedValue({
      ...BASE_SETTINGS,
      lastLiquidationPushAt: new Date(Date.now() - 10 * 60 * 1000),
    });

    await service.notifyLiquidationRisk('user-1', {
      healthFactor: 0.97,
      shortfallUsd: 34,
    });

    expect(mockExpoPushService.send).not.toHaveBeenCalled();
  });

  it('sends a liquidation push once the cooldown has elapsed', async () => {
    mockPrismaService.notificationSettings.upsert.mockResolvedValue({
      ...BASE_SETTINGS,
      lastLiquidationPushAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    mockPrismaService.userE2eePublicKey.findUnique.mockResolvedValue({
      userId: 'user-1',
      publicKey: 'pubkey-base64',
    });
    mockExpoPushService.encryptForUser.mockReturnValue({
      ciphertext: 'ct',
      nonce: 'n',
      ephemeralPublicKey: 'epk',
    });
    mockExpoPushService.send.mockResolvedValue({
      tickets: [{ status: 'ok', id: 'ticket-1' }],
      staleTokens: [],
    });

    await service.notifyLiquidationRisk('user-1', {
      healthFactor: 0.97,
      shortfallUsd: 34,
    });

    expect(mockExpoPushService.send).toHaveBeenCalled();
    expect(mockPrismaService.notificationSettings.update).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { lastLiquidationPushAt: expect.any(Date) as Date },
    });
    expect(mockPrismaService.userNotification.update).toHaveBeenCalledWith({
      where: { id: 'notif-1' },
      data: { pushDeliveredAt: expect.any(Date) as Date },
    });
  });

  it('purges a token Expo reports as DeviceNotRegistered', async () => {
    mockPrismaService.userE2eePublicKey.findUnique.mockResolvedValue(null);
    mockExpoPushService.send.mockResolvedValue({
      tickets: [
        {
          status: 'error',
          message: 'gone',
          details: { error: 'DeviceNotRegistered' },
        },
      ],
      staleTokens: ['ExponentPushToken[abc]'],
    });

    await service.notifyUser('user-1', NotificationKind.GENERAL_ANNOUNCEMENT, {
      title: 'Update',
      body: 'Something happened',
    });

    expect(mockPrismaService.pushToken.deleteMany).toHaveBeenCalledWith({
      where: { token: { in: ['ExponentPushToken[abc]'] } },
    });
  });

  it('skips the push (fail-closed) for a sensitive kind with no E2EE key on file', async () => {
    mockPrismaService.userE2eePublicKey.findUnique.mockResolvedValue(null);

    await service.notifyLiquidationRisk('user-1', {
      healthFactor: 0.97,
      shortfallUsd: 34,
    });

    expect(mockExpoPushService.send).not.toHaveBeenCalled();
  });

  it('never exposes the real health-factor text to Expo — only ciphertext', async () => {
    mockPrismaService.userE2eePublicKey.findUnique.mockResolvedValue({
      userId: 'user-1',
      publicKey: 'pubkey-base64',
    });
    mockExpoPushService.encryptForUser.mockReturnValue({
      ciphertext: 'ct-opaque-bytes',
      nonce: 'n',
      ephemeralPublicKey: 'epk',
    });
    mockExpoPushService.send.mockResolvedValue({
      tickets: [{ status: 'ok', id: 'ticket-1' }],
      staleTokens: [],
    });

    await service.notifyLiquidationRisk('user-1', {
      healthFactor: 0.97,
      shortfallUsd: 34,
    });

    expect(mockExpoPushService.encryptForUser).toHaveBeenCalledWith(
      'pubkey-base64',
      expect.objectContaining({
        title: 'Liquidation risk alert',
        body: expect.stringContaining('0.97') as string,
      }),
    );

    const sentArgs = mockExpoPushService.send.mock.calls[0][1];
    const serialized = JSON.stringify(sentArgs);
    expect(serialized).not.toMatch(/0\.97/);
    expect(serialized).not.toMatch(/HF=/);
    expect(serialized).not.toMatch(/34/);
    expect(sentArgs.data?.ciphertext).toBe('ct-opaque-bytes');
  });

  describe('markRead', () => {
    it('throws NotFoundException for a notification not owned by the caller', async () => {
      mockPrismaService.userNotification.findFirst.mockResolvedValue(null);

      await expect(service.markRead('user-1', 'notif-999')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('marks an unread notification as read', async () => {
      mockPrismaService.userNotification.findFirst.mockResolvedValue({
        id: 'notif-1',
        userId: 'user-1',
        readAt: null,
      });

      await service.markRead('user-1', 'notif-1');

      expect(mockPrismaService.userNotification.update).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
        data: { readAt: expect.any(Date) as Date },
      });
    });

    it('is idempotent for an already-read notification', async () => {
      mockPrismaService.userNotification.findFirst.mockResolvedValue({
        id: 'notif-1',
        userId: 'user-1',
        readAt: new Date('2026-01-01T00:00:00Z'),
      });

      await service.markRead('user-1', 'notif-1');

      expect(mockPrismaService.userNotification.update).not.toHaveBeenCalled();
    });
  });
});
