import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { HorizonService } from '../stellar/horizon.service';
import { DepositsService } from './deposits.service';

/**
 * Watches pending deposits and updates their confirmation count.
 * Polls Horizon for the current ledger sequence and checks if each
 * deposit has reached the required number of confirmations.
 */
@Injectable()
export class DepositWatcherService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(DepositWatcherService.name);
  private isProcessing = false;
  private pollTimeout?: NodeJS.Timeout;

  constructor(
    private readonly configService: AppConfigService,
    private readonly horizonService: HorizonService,
    private readonly depositsService: DepositsService,
  ) {}

  onApplicationBootstrap() {
    this.logger.log('Starting deposit watcher polling loop...');
    this.startPolling();
  }

  onModuleDestroy() {
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
    }
  }

  private startPolling() {
    const interval = this.configService.deposits.watcherPollIntervalMs;
    this.pollTimeout = setTimeout(() => {
      void this.runWatcher().then(() => {
        this.startPolling();
      });
    }, interval);
  }

  /**
   * One watch cycle: check current ledger and update all pending deposits.
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

      // Get all pending deposits
      const pendingDeposits = await this.depositsService.getPendingDeposits();

      for (const deposit of pendingDeposits) {
        try {
          // Verify the transaction still exists on-chain
          const tx = await this.horizonService.getTransactionByHash(
            deposit.txHash,
          );

          if (!tx) {
            // Transaction not found - might be orphaned
            this.logger.warn(
              `Transaction ${deposit.txHash} not found on-chain, marking as orphaned`,
            );
            await this.depositsService.markDepositOrphaned(deposit.id);
            continue;
          }

          // Check if transaction is successful
          if (tx.successful === false) {
            this.logger.warn(
              `Transaction ${deposit.txHash} failed on-chain, marking as orphaned`,
            );
            await this.depositsService.markDepositOrphaned(deposit.id);
            continue;
          }

          // Calculate confirmations
          const confirmationsSeen = currentLedger - deposit.ledgerSeq;

          // Update deposit
          await this.depositsService.updateDepositConfirmations(
            deposit.id,
            confirmationsSeen,
            currentLedger,
          );
        } catch (error) {
          this.logger.error(
            `Failed to process deposit ${deposit.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Error in deposit watcher cycle: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.isProcessing = false;
    }
  }
}
