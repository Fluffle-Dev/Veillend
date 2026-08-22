import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePushTokenDto } from './dto/create-push-token.dto';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';
import { PushTokenResponseDto } from './dto/push-token-response.dto';
import { NotificationSettingsResponseDto } from './dto/notification-settings-response.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upserts by `token` (globally unique) rather than by user: the same
   * physical device token can move to a different user account (sign-out /
   * sign-in as someone else on the same device), and re-registering it
   * should reassign ownership rather than create a duplicate row.
   */
  async upsertPushToken(
    userId: string,
    dto: CreatePushTokenDto,
  ): Promise<PushTokenResponseDto> {
    const token = await this.prisma.pushToken.upsert({
      where: { token: dto.token },
      create: {
        userId,
        token: dto.token,
        platform: dto.platform,
        locale: dto.locale,
      },
      update: {
        userId,
        platform: dto.platform,
        locale: dto.locale,
      },
    });

    this.logger.log(
      `Push token registered for user ${userId} (platform=${dto.platform})`,
    );

    return {
      id: token.id,
      platform: token.platform,
      locale: token.locale,
      createdAt: token.createdAt,
    };
  }

  async deletePushToken(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.pushToken.deleteMany({
      where: { id, userId },
    });

    if (count === 0) {
      throw new NotFoundException('Push token not found');
    }

    this.logger.log(`Push token ${id} removed for user ${userId}`);
  }

  async getNotificationSettings(
    userId: string,
  ): Promise<NotificationSettingsResponseDto> {
    const settings = await this.prisma.notificationSettings.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });

    return this.toSettingsResponse(settings);
  }

  async updateNotificationSettings(
    userId: string,
    dto: UpdateNotificationSettingsDto,
  ): Promise<NotificationSettingsResponseDto> {
    const settings = await this.prisma.notificationSettings.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: { ...dto },
    });

    this.logger.log(`Notification settings updated for user ${userId}`);

    return this.toSettingsResponse(settings);
  }

  async setE2eeKey(
    userId: string,
    publicKey: string,
  ): Promise<{ updatedAt: Date }> {
    const key = await this.prisma.userE2eePublicKey.upsert({
      where: { userId },
      create: { userId, publicKey },
      update: { publicKey },
    });

    this.logger.log(`E2EE public key set for user ${userId}`);

    return { updatedAt: key.updatedAt };
  }

  private toSettingsResponse(settings: {
    liquidationRisk: boolean;
    liquidationOpportunity: boolean;
    generalAnnouncements: boolean;
    marketing: boolean;
    security: boolean;
    updatedAt: Date;
  }): NotificationSettingsResponseDto {
    return {
      liquidationRisk: settings.liquidationRisk,
      liquidationOpportunity: settings.liquidationOpportunity,
      generalAnnouncements: settings.generalAnnouncements,
      marketing: settings.marketing,
      security: settings.security,
      updatedAt: settings.updatedAt,
    };
  }
}
