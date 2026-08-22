import { NotificationKind } from '@prisma/client';

export class UserNotificationDto {
  id: string;
  kind: NotificationKind;
  payload: unknown;
  readAt: Date | null;
  pushDeliveredAt: Date | null;
  createdAt: Date;
}
