import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Asset, Position } from '@prisma/client';

export type PositionWithAsset = Position & { asset: Asset };

export interface VeilLendPortfolioData {
  positions: PositionWithAsset[];
  collateralValue: number;
  borrowedValue: number;
}

@Injectable()
export class PortfoliosRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Loads a user's VeilLend `Position` rows from the indexer tables and sums
   * their last-synced oracle-priced USD values into portfolio totals.
   * `depositedUsd`/`borrowedUsd` on each row are cached by the indexer sync
   * path as (oracle price × amount), so summing them is equivalent to
   * sum(oracle price × deposited) / sum(oracle price × borrowed).
   *
   * Returns `{}` when the wallet has no indexed user or no positions, so
   * callers can tell "nothing to show" apart from a genuine zero-value
   * portfolio.
   */
  async getVeilLendPortfolio(
    userAddress: string,
  ): Promise<VeilLendPortfolioData | Record<string, never>> {
    return this.prisma.withRepeatableRead(
      async (db): Promise<VeilLendPortfolioData | Record<string, never>> => {
        const user = await db.user.findUnique({
          where: { walletAddress: userAddress },
        });
        if (!user) {
          return {};
        }

        const positions = await db.position.findMany({
          where: { userId: user.id },
          include: { asset: true },
        });

        if (positions.length === 0) {
          return {};
        }

        const collateralValue = positions.reduce(
          (sum, p) => sum + Number(p.depositedUsd),
          0,
        );
        const borrowedValue = positions.reduce(
          (sum, p) => sum + Number(p.borrowedUsd),
          0,
        );

        return { positions, collateralValue, borrowedValue };
      },
    );
  }
}
