import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { Platform } from '@prisma/client';
import { IsExpoPushToken } from '../../common/validators/is-expo-push-token.validator';

export class CreatePushTokenDto {
  @IsExpoPushToken()
  token: string;

  @IsEnum(Platform)
  platform: Platform;

  @IsOptional()
  @IsString()
  @MaxLength(35)
  locale?: string;
}
