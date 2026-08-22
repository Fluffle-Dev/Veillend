import { IsOptional, IsString } from 'class-validator';

export class NotificationsConfig {
  @IsOptional()
  @IsString()
  EXPO_ACCESS_TOKEN?: string;
}
