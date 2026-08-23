import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';
import { HorizonService } from '../stellar/horizon.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { WithdrawalStatus, NotificationKind } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class WithdrawalsService {
  private readonly logger = new Logger(WithdrawalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: AppConfigService,
    private readonly horizonService: HorizonService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Creates a new withdrawal request.
   * Checks whitelist status and applies timelock if needed.
   */
  async createWithdrawal(
    userId: string,
    userWallet: string,
    dto: CreateWithdrawalDto,
  ) {
    // Find the asset
    const asset = await this.prisma.asset.findFirst({
      where: {
        OR: [
          { contractId: dto.assetAddress },
          { id: dto.assetAddress },
          { code: dto.assetAddress },
        ],
      },
    });

    if (!asset) {
      throw new BadRequestException(`Asset not found: ${dto.assetAddress}`);
    }

    // Check if user has sufficient balance (placeholder - would need actual balance check)
    // For now, we'll just check if the user has a position with enough deposited
    const position = await this.prisma.position.findUnique({
      where: {
        userId_assetId: {
          userId,
          assetId: asset.id,
        },
      },
    });

    if (!position || position.depositedRaw < dto.amountStroops) {
      throw new BadRequestException('Insufficient balance for withdrawal');
    }

    // Check if destination is whitelisted
    const whitelistEntry = await this.prisma.addressWhitelist.findFirst({
      where: {
        userId,
        address: dto.destinationAddress,
      },
    });

    const now = new Date();
    let timelockUntil: Date | null = null;
    let whitelistApproved = false;

    if (whitelistEntry) {
      // Check if timelock has passed
      if (whitelistEntry.timelockUntil && whitelistEntry.timelockUntil > now) {
        // Timelock still active - check if instant mode applies
        const instantLimitUsd =
          this.configService.withdrawals.instantWhitelistMaxUsd;
        if (
          whitelistEntry.isInstantApproved &&
          whitelistEntry.instantLimitUsd &&
          Number(whitelistEntry.instantLimitUsd) >= instantLimitUsd
        ) {
          // Instant mode - no timelock needed
          whitelistApproved = true;
        } else {
          // Timelock still active
          timelockUntil = whitelistEntry.timelockUntil;
          whitelistApproved = false;
        }
      } else {
        // Timelock passed or no timelock
        whitelistApproved = true;
      }
    } else {
      // Destination not whitelisted - apply timelock
      const timelockHours = this.configService.withdrawals.timelockHours;
      timelockUntil = new Date(now.getTime() + timelockHours * 60 * 60 * 1000);
      whitelistApproved = false;

      // Send security alert
      await this.notificationsService.notifyUser(
        userId,
        NotificationKind.SECURITY_ALERT,
        {
          title: 'New withdrawal address',
          body: `A withdrawal to ${dto.destinationAddress} has been requested. A ${timelockHours}-hour timelock is active.`,
          data: {
            destinationAddress: dto.destinationAddress,
            timelockUntil: timelockUntil.toISOString(),
          },
        },
      );
    }

    // Get min confirmations from asset config
    const assetConfig = await this.prisma.assetWithdrawalConfig.findUnique({
      where: { assetId: asset.id },
    });

    const confirmationsRequired =
      assetConfig?.minConfirmations ||
      this.configService.withdrawals.defaultMinConfirmations;

    // Generate nonce for replay protection
    const nonce = crypto.randomBytes(32).toString('hex');
    const nonceHash = crypto.createHash('sha256').update(nonce).digest('hex');

    // Create the withdrawal request
    const withdrawal = await this.prisma.withSerializable(async (tx) => {
      const withdrawalRequest = await tx.withdrawalRequest.create({
        data: {
          userWallet,
          userId,
          assetId: asset.id,
          amountStroops: dto.amountStroops,
          destinationAddress: dto.destinationAddress,
          destinationTag: dto.destinationTag,
          whitelistApproved,
          whitelistEntryAddedAt: whitelistEntry?.createdAt || null,
          timelockUntil,
          status: WithdrawalStatus.DRAFT,
          confirmationsRequired,
        },
      });

      // Create nonce record
      await tx.withdrawNonce.create({
        data: {
          nonce: nonceHash,
          withdrawalRequestId: withdrawalRequest.id,
        },
      });

      return withdrawalRequest;
    });

    this.logger.log(
      `Withdrawal created: ${withdrawal.id} for user ${userId}, amount ${dto.amountStroops} stroops to ${dto.destinationAddress}`,
    );

    return {
      ...withdrawal,
      nonce, // Return the raw nonce for XDR memo
    };
  }

  /**
   * Get all withdrawals for a user.
   */
  async getUserWithdrawals(
    userId: string,
    options?: {
      status?: WithdrawalStatus;
      take?: number;
      skip?: number;
    },
  ) {
    const where = {
      userId,
      ...(options?.status ? { status: options.status } : {}),
    };

    const [withdrawals, count] = await Promise.all([
      this.prisma.withdrawalRequest.findMany({
        where,
        include: { asset: true },
        orderBy: { createdAt: 'desc' },
        take: options?.take || 50,
        skip: options?.skip || 0,
      }),
      this.prisma.withdrawalRequest.count({ where }),
    ]);

    return { withdrawals, count };
  }

  /**
   * Get a single withdrawal by ID.
   */
  async getWithdrawalById(withdrawalId: string, userId: string) {
    const withdrawal = await this.prisma.withdrawalRequest.findFirst({
      where: {
        id: withdrawalId,
        userId,
      },
      include: { asset: true },
    });

    if (!withdrawal) {
      throw new NotFoundException('Withdrawal not found');
    }

    return withdrawal;
  }

  /**
   * Update withdrawal status after user signs the XDR.
   */
  async signWithdrawal(
    withdrawalId: string,
    userId: string,
    xdr: string,
    txHash: string,
  ) {
    const withdrawal = await this.prisma.withdrawalRequest.findFirst({
      where: {
        id: withdrawalId,
        userId,
      },
    });

    if (!withdrawal) {
      throw new NotFoundException('Withdrawal not found');
    }

    if (withdrawal.status !== WithdrawalStatus.DRAFT) {
      throw new BadRequestException(
        `Withdrawal cannot be signed in status: ${withdrawal.status}`,
      );
    }

    // Check if timelock has passed
    if (withdrawal.timelockUntil && withdrawal.timelockUntil > new Date()) {
      throw new ForbiddenException(
        `Withdrawal is timelocked until ${withdrawal.timelockUntil.toISOString()}`,
      );
    }

    // Check if nonce was already used
    const nonceRecord = await this.prisma.withdrawNonce.findFirst({
      where: {
        withdrawalRequestId: withdrawalId,
        used: true,
      },
    });

    if (nonceRecord) {
      throw new ConflictException('Nonce already used - replay detected');
    }

    // Mark nonce as used
    await this.prisma.withdrawNonce.updateMany({
      where: {
        withdrawalRequestId: withdrawalId,
      },
      data: {
        used: true,
      },
    });

    // Update withdrawal
    return this.prisma.withdrawalRequest.update({
      where: { id: withdrawalId },
      data: {
        status: WithdrawalStatus.SIGNED,
        xdr,
        txHash,
        signedAt: new Date(),
      },
    });
  }

  /**
   * Submit withdrawal to the network.
   */
  async submitWithdrawal(withdrawalId: string, userId: string, txHash: string) {
    const withdrawal = await this.prisma.withdrawalRequest.findFirst({
      where: {
        id: withdrawalId,
        userId,
      },
    });

    if (!withdrawal) {
      throw new NotFoundException('Withdrawal not found');
    }

    if (withdrawal.status !== WithdrawalStatus.SIGNED) {
      throw new BadRequestException(
        `Withdrawal cannot be submitted in status: ${withdrawal.status}`,
      );
    }

    return this.prisma.withdrawalRequest.update({
      where: { id: withdrawalId },
      data: {
        status: WithdrawalStatus.SENT,
        txHash,
        submittedAt: new Date(),
      },
    });
  }

  /**
   * Update withdrawal confirmations and status.
   * Called by the WithdrawalWatcher.
   */
  async updateWithdrawalConfirmations(
    withdrawalId: string,
    confirmationsSeen: number,
    currentLedger: number,
    feeChargedStroops?: bigint,
  ) {
    const withdrawal = await this.prisma.withdrawalRequest.findUnique({
      where: { id: withdrawalId },
    });

    if (!withdrawal) {
      return null;
    }

    // Check if withdrawal is confirmed based on confirmations seen vs required
    const isConfirmed = confirmationsSeen >= withdrawal.confirmationsRequired;

    if (isConfirmed && withdrawal.status === WithdrawalStatus.SENT) {
      // Debit user balance
      return await this.prisma.withSerializable(async (tx) => {
        // Update withdrawal status
        const updatedWithdrawal = await tx.withdrawalRequest.update({
          where: { id: withdrawalId },
          data: {
            confirmationsSeen,
            status: WithdrawalStatus.CONFIRMED,
            confirmedAt: new Date(),
            feeChargedStroops:
              feeChargedStroops || withdrawal.feeChargedStroops,
          },
        });

        // Debit position
        await tx.position.update({
          where: {
            userId_assetId: {
              userId: withdrawal.userId,
              assetId: withdrawal.assetId,
            },
          },
          data: {
            depositedRaw: {
              decrement: withdrawal.amountStroops,
            },
            isStale: true,
          },
        });

        this.logger.log(
          `Withdrawal ${withdrawalId} confirmed and debited: ${withdrawal.amountStroops} stroops`,
        );

        return updatedWithdrawal;
      });
    } else if (!isConfirmed && withdrawal.status === WithdrawalStatus.SENT) {
      // Just update confirmations count
      return this.prisma.withdrawalRequest.update({
        where: { id: withdrawalId },
        data: {
          confirmationsSeen,
        },
      });
    }

    return withdrawal;
  }

  /**
   * Mark a withdrawal as orphaned (transaction not found or forked).
   */
  async markWithdrawalOrphaned(withdrawalId: string, error?: string) {
    return this.prisma.withdrawalRequest.update({
      where: { id: withdrawalId },
      data: {
        status: WithdrawalStatus.ORPHANED,
        error: error || 'Transaction orphaned or not found on-chain',
      },
    });
  }

  /**
   * Cancel a withdrawal request.
   */
  async cancelWithdrawal(withdrawalId: string, userId: string) {
    const withdrawal = await this.prisma.withdrawalRequest.findFirst({
      where: {
        id: withdrawalId,
        userId,
      },
    });

    if (!withdrawal) {
      throw new NotFoundException('Withdrawal not found');
    }

    if (
      withdrawal.status === WithdrawalStatus.CONFIRMED ||
      withdrawal.status === WithdrawalStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Withdrawal cannot be cancelled in status: ${withdrawal.status}`,
      );
    }

    return this.prisma.withdrawalRequest.update({
      where: { id: withdrawalId },
      data: {
        status: WithdrawalStatus.CANCELLED,
      },
    });
  }

  /**
   * Get pending withdrawals for the watcher to process.
   */
  async getPendingWithdrawals() {
    return this.prisma.withdrawalRequest.findMany({
      where: {
        status: WithdrawalStatus.SENT,
      },
      include: { asset: true },
    });
  }

  /**
   * Add address to whitelist.
   */
  async addToWhitelist(
    userId: string,
    address: string,
    label?: string,
    instantMode?: boolean,
    instantLimitUsd?: number,
  ) {
    // Check if already whitelisted
    const existing = await this.prisma.addressWhitelist.findFirst({
      where: {
        userId,
        address,
      },
    });

    if (existing) {
      throw new ConflictException('Address already whitelisted');
    }

    const now = new Date();
    const timelockHours = this.configService.withdrawals.timelockHours;
    const timelockUntil = new Date(
      now.getTime() + timelockHours * 60 * 60 * 1000,
    );

    // Create whitelist entry
    const whitelistEntry = await this.prisma.addressWhitelist.create({
      data: {
        userId,
        address,
        label,
        timelockUntil: instantMode ? null : timelockUntil,
        isInstantApproved: instantMode || false,
        instantLimitUsd: instantLimitUsd || null,
      },
    });

    // Send notification
    await this.notificationsService.notifyUser(
      userId,
      NotificationKind.SECURITY_ALERT,
      {
        title: 'Address whitelisted',
        body: instantMode
          ? `Address ${address} has been whitelisted with instant mode.`
          : `Address ${address} has been added. It will be active in ${timelockHours} hours.`,
        data: {
          address,
          timelockUntil: instantMode ? null : timelockUntil.toISOString(),
          instantMode,
        },
      },
    );

    this.logger.log(
      `Address ${address} whitelisted for user ${userId} (instant: ${instantMode})`,
    );

    return whitelistEntry;
  }

  /**
   * Remove address from whitelist.
   */
  async removeFromWhitelist(userId: string, whitelistId: string) {
    const entry = await this.prisma.addressWhitelist.findFirst({
      where: {
        id: whitelistId,
        userId,
      },
    });

    if (!entry) {
      throw new NotFoundException('Whitelist entry not found');
    }

    await this.prisma.addressWhitelist.delete({
      where: { id: whitelistId },
    });

    this.logger.log(
      `Address ${entry.address} removed from whitelist for user ${userId}`,
    );

    return { success: true };
  }

  /**
   * Get user's whitelist.
   */
  async getWhitelist(userId: string) {
    return this.prisma.addressWhitelist.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
