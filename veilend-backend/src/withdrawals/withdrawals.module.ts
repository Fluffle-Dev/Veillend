import { Module } from '@nestjs/common';
import { WithdrawalsController } from './withdrawals.controller';
import { WithdrawalsService } from './withdrawals.service';
import { WithdrawalWatcherService } from './withdrawal-watcher.service';
import { AuthModule } from '../auth/auth.module';
import { StellarModule } from '../stellar/stellar.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [ConfigModule, AuthModule, StellarModule, NotificationsModule],
  controllers: [WithdrawalsController],
  providers: [WithdrawalsService, WithdrawalWatcherService],
  exports: [WithdrawalsService],
})
export class WithdrawalsModule {}
