import { IsString, IsNotEmpty, IsInt, IsPositive } from 'class-validator';

export class CreateDepositDto {
  @IsString()
  @IsNotEmpty()
  assetAddress: string;

  @IsInt()
  @IsPositive()
  amountStroops: number;

  @IsString()
  @IsNotEmpty()
  txHash: string;

  @IsInt()
  @IsPositive()
  ledgerSeq: number;
}
