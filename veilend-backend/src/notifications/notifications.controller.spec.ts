import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { Order } from '../common/dto/page-options.dto';
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

describe('NotificationsController', () => {
  let controller: NotificationsController;

  const mockNotificationsService = {
    getNotifications: jest.fn(),
    markRead: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('scopes the paginated list to the authenticated user', async () => {
    mockNotificationsService.getNotifications.mockResolvedValue({
      data: [],
      meta: {
        page: 1,
        take: 10,
        itemCount: 0,
        pageCount: 0,
        hasPreviousPage: false,
        hasNextPage: false,
      },
    });

    await controller.getNotifications(
      { page: 1, take: 10, order: Order.DESC, skip: 0 },
      reqFor('user-1'),
    );

    expect(mockNotificationsService.getNotifications).toHaveBeenCalledWith(
      'user-1',
      { page: 1, take: 10, order: Order.DESC, skip: 0 },
    );
  });

  it('throws UnauthorizedException without an authenticated user id', async () => {
    await expect(
      controller.getNotifications(
        { page: 1, take: 10, order: Order.ASC, skip: 0 },
        reqFor(undefined),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('delegates mark-read to the service, scoped to the caller', async () => {
    mockNotificationsService.markRead.mockResolvedValue(undefined);

    const result = await controller.markRead('notif-1', reqFor('user-1'));

    expect(mockNotificationsService.markRead).toHaveBeenCalledWith(
      'user-1',
      'notif-1',
    );
    expect(result).toEqual({ read: true });
  });

  it('propagates NotFoundException for a notification not owned by the caller', async () => {
    mockNotificationsService.markRead.mockRejectedValue(
      new NotFoundException('Notification not found'),
    );

    await expect(
      controller.markRead('notif-999', reqFor('user-1')),
    ).rejects.toThrow(NotFoundException);
  });
});
