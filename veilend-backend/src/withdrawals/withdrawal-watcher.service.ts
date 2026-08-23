import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { HorizonService } from '../stellar/horizon.service';
import { WithdrawalsService } from './withdrawals.service';

/**
 * Watches pending withdrawals and updates their confirmation count.
 * Polls Horizon for the current ledger sequence and checks if each
 * withdrawal has reached the required number of confirmations.
 */
@Injectable()
export class WithdrawalWatcherService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(WithdrawalWatcherService.name);
  private isProcessing = false;
  private pollTimeout?: NodeJS.Timeout;

  constructor(
    private readonly configService: AppConfigService,
    private readonly horizonService: HorizonService,
    private readonly withdrawalsService: WithdrawalsService,
  ) {}

  onApplicationBootstrap() {
    this.logger.log('Starting withdrawal watcher polling loop...');
    this.startPolling();
  }

  onModuleDestroy() {
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
    }
  }

  private startPolling() {
    const interval = this.configService.withdrawals.watcherPollIntervalMs;
    this.pollTimeout = setTimeout(() => {
      void this.runWatcher().then(() => {
        this.startPolling();
      });
    }, interval);
  }

  /**
   * One watch cycle: check current ledger and update all pending withdrawals.
   */
  async runWatcher() {
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;

    try {
      // Get current ledger from Horizon
      const currentLedger = await this.horizonService.getCurrentLedger();
      this.logger.debug(`Current ledger: ${currentLedger}`);

      // Get all pending withdrawals
      const pendingWithdrawals =
        await this.withdrawalsService.getPendingWithdrawals();

      for (const withdrawal of pendingWithdrawals) {
        try {
          // Verify the transaction still exists on-chain
          const tx = await this.horizonService.getTransactionByHash(
            withdrawal.txHash || '',
          );

          if (!tx) {
            // Transaction not found - might be orphaned
            this.logger.warn(
              `Transaction ${withdrawal.txHash} not found on-chain, marking as orphaned`,
            );
            await this.withdrawalsService.markWithdrawalOrphaned(
              withdrawal.id,
              'Transaction not found on-chain',
            );
            continue;
          }

          // Check if transaction is successful
          if (tx.successful === false) {
            this.logger.warn(
              `Transaction ${withdrawal.txHash} failed on-chain, marking as orphaned`,
            );
            await this.withdrawalsService.markWithdrawalOrphaned(
              withdrawal.id,
              'Transaction failed on-chain',
            );
            continue;
          }

          // Calculate confirmations (simplified - would need actual submission ledger)
          // For now, use tx.ledger as submission ledger
          const submissionLedger = Number(tx.ledger);
          const confirmationsSeen = currentLedger - submissionLedger;

          // Get fee charged
          const feeCharged = BigInt(tx.fee_charged || 0);

          // Update withdrawal
          await this.withdrawalsService.updateWithdrawalConfirmations(
            withdrawal.id,
            confirmationsSeen,
            currentLedger,
            feeCharged,
          );
        } catch (error) {
          this.logger.error(
            `Failed to process withdrawal ${withdrawal.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Error in withdrawal watcher cycle: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.isProcessing = false;
    }
  }
}
