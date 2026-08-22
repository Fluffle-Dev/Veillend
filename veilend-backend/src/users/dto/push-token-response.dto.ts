import { Platform } from '@prisma/client';

export class PushTokenResponseDto {
  id: string;
  platform: Platform;
  locale: string | null;
  createdAt: Date;
}
