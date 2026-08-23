import { Module } from '@nestjs/common';
import { DepositsController } from './deposits.controller';
import { DepositsService } from './deposits.service';
import { DepositWatcherService } from './deposit-watcher.service';
import { AuthModule } from '../auth/auth.module';
import { StellarModule } from '../stellar/stellar.module';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [ConfigModule, AuthModule, StellarModule],
  controllers: [DepositsController],
  providers: [DepositsService, DepositWatcherService],
  exports: [DepositsService],
})
export class DepositsModule {}
