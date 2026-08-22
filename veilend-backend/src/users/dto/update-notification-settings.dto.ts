import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateNotificationSettingsDto {
  @IsOptional()
  @IsBoolean()
  liquidationRisk?: boolean;

  @IsOptional()
  @IsBoolean()
  liquidationOpportunity?: boolean;

  @IsOptional()
  @IsBoolean()
  generalAnnouncements?: boolean;

  @IsOptional()
  @IsBoolean()
  marketing?: boolean;

  @IsOptional()
  @IsBoolean()
  security?: boolean;
}
