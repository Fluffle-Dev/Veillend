import {
  IsString,
  IsNotEmpty,
  IsInt,
  IsPositive,
  IsOptional,
} from 'class-validator';

export class CreateWithdrawalDto {
  @IsString()
  @IsNotEmpty()
  assetAddress: string;

  @IsInt()
  @IsPositive()
  amountStroops: number;

  @IsString()
  @IsNotEmpty()
  destinationAddress: string;

  @IsString()
  @IsOptional()
  destinationTag?: string;
}
