import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Platform } from '@prisma/client';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

describe('UsersService', () => {
  let service: UsersService;

  const mockPrismaService = {
    pushToken: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    notificationSettings: {
      upsert: jest.fn(),
    },
    userE2eePublicKey: {
      upsert: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('upsertPushToken', () => {
    it('upserts by token, assigning it to the current user', async () => {
      mockPrismaService.pushToken.upsert.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        token: 'ExponentPushToken[abc]',
        platform: Platform.IOS,
        locale: 'en-US',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });

      const result = await service.upsertPushToken('user-1', {
        token: 'ExponentPushToken[abc]',
        platform: Platform.IOS,
        locale: 'en-US',
      });

      expect(mockPrismaService.pushToken.upsert).toHaveBeenCalledWith({
        where: { token: 'ExponentPushToken[abc]' },
        create: {
          userId: 'user-1',
          token: 'ExponentPushToken[abc]',
          platform: Platform.IOS,
          locale: 'en-US',
        },
        update: {
          userId: 'user-1',
          platform: Platform.IOS,
          locale: 'en-US',
        },
      });
      expect(result).toMatchObject({ id: 'token-1', platform: Platform.IOS });
    });
  });

  describe('deletePushToken', () => {
    it('throws NotFoundException when no row is owned by the requesting user', async () => {
      mockPrismaService.pushToken.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.deletePushToken('user-1', 'token-999'),
      ).rejects.toThrow(NotFoundException);
    });

    it('deletes only the caller-owned row', async () => {
      mockPrismaService.pushToken.deleteMany.mockResolvedValue({ count: 1 });

      await service.deletePushToken('user-1', 'token-1');

      expect(mockPrismaService.pushToken.deleteMany).toHaveBeenCalledWith({
        where: { id: 'token-1', userId: 'user-1' },
      });
    });
  });

  describe('notification settings', () => {
    it('returns default settings on first read', async () => {
      mockPrismaService.notificationSettings.upsert.mockResolvedValue({
        userId: 'user-1',
        liquidationRisk: true,
        liquidationOpportunity: true,
        generalAnnouncements: true,
        marketing: false,
        security: true,
        lastLiquidationPushAt: null,
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });

      const result = await service.getNotificationSettings('user-1');

      expect(result).toEqual({
        liquidationRisk: true,
        liquidationOpportunity: true,
        generalAnnouncements: true,
        marketing: false,
        security: true,
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });
    });

    it('merges a partial update into the settings row', async () => {
      mockPrismaService.notificationSettings.upsert.mockResolvedValue({
        userId: 'user-1',
        liquidationRisk: true,
        liquidationOpportunity: true,
        generalAnnouncements: true,
        marketing: true,
        security: true,
        lastLiquidationPushAt: null,
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      });

      const result = await service.updateNotificationSettings('user-1', {
        marketing: true,
      });

      expect(
        mockPrismaService.notificationSettings.upsert,
      ).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: { userId: 'user-1', marketing: true },
        update: { marketing: true },
      });
      expect(result.marketing).toBe(true);
    });
  });

  describe('setE2eeKey', () => {
    it('upserts the public key for the user', async () => {
      mockPrismaService.userE2eePublicKey.upsert.mockResolvedValue({
        userId: 'user-1',
        publicKey: 'base64key',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });

      const result = await service.setE2eeKey('user-1', 'base64key');

      expect(mockPrismaService.userE2eePublicKey.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: { userId: 'user-1', publicKey: 'base64key' },
        update: { publicKey: 'base64key' },
      });
      expect(result.updatedAt).toEqual(new Date('2026-01-01T00:00:00Z'));
    });
  });
});
