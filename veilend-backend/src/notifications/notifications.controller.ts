import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { GetNotificationsQueryDto } from './dto/get-notifications-query.dto';
import { UserNotificationDto } from './dto/user-notification.dto';
import { PageDto } from '../common/dto/page.dto';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async getNotifications(
    @Query() query: GetNotificationsQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<PageDto<UserNotificationDto>> {
    return this.notificationsService.getNotifications(
      this.requireUserId(req),
      query,
    );
  }

  @Post(':id/read')
  async markRead(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ read: true }> {
    await this.notificationsService.markRead(this.requireUserId(req), id);
    return { read: true };
  }

  private requireUserId(req: AuthenticatedRequest): string {
    if (!req.user.userId) {
      throw new UnauthorizedException('No user authenticated');
    }
    return req.user.userId;
  }
}
