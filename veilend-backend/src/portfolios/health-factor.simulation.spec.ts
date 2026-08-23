import {
  computeHealthFactor,
  PositionLike,
} from '../common/utils/health-factor.util';

describe('Health Factor Simulation & Integration', () => {
  describe('computeHealthFactor Reference Mathematical Checks', () => {
    it('generates 50 random positions and cross-checks HF tolerance against manual math (1 stroop = 1e-7)', () => {
      for (let i = 0; i < 50; i++) {
        // Random deposit, borrow, mcr
        const depUsd = Math.random() * 10000;
        const borUsd = Math.random() * 5000;
        const mcr = 0.5 + Math.random() * 0.45; // 0.5 to 0.95

        const positions: PositionLike[] = [
          {
            assetId: 'asset-rand',
            assetCode: 'RAND',
            depositedUsd: depUsd,
            borrowedUsd: borUsd,
            asset: { minCollateralRatio: mcr },
          },
        ];

        const result = computeHealthFactor(positions);

        const expectedHf = borUsd === 0 ? Infinity : (depUsd * mcr) / borUsd;

        if (expectedHf === Infinity) {
          expect(result.healthFactor).toBe(Infinity);
        } else {
          expect(
            Math.abs(result.healthFactor! - expectedHf),
          ).toBeLessThanOrEqual(1e-7);
        }
      }
    });

    it('hand-calculated two-collateral, one-borrow case (XLM mcr=0.7, ETH mcr=0.65) produces the exact expected HF value', () => {
      const positions: PositionLike[] = [
        {
          assetId: 'asset-xlm',
          assetCode: 'XLM',
          depositedUsd: 1000,
          borrowedUsd: 0,
          asset: { minCollateralRatio: 0.7 },
        },
        {
          assetId: 'asset-eth',
          assetCode: 'ETH',
          depositedUsd: 2000,
          borrowedUsd: 500,
          asset: { minCollateralRatio: 0.65 },
        },
      ];

      const result = computeHealthFactor(positions);

      const expectedWeightedCollateral = 1000 * 0.7 + 2000 * 0.65; // 700 + 1300 = 2000
      const expectedTotalBorrowed = 500;
      const expectedHf = expectedWeightedCollateral / expectedTotalBorrowed; // 2000 / 500 = 4

      expect(result.healthFactor).toBeCloseTo(expectedHf, 7);
      expect(result.totalWeightedCollateralUsd).toBeCloseTo(2000, 7);
      expect(result.totalBorrowedUsd).toBeCloseTo(500, 7);
    });

    it('stale price for any asset that backs a live position returns healthFactor: null and lists the offending code in stalePrices', () => {
      const positions: PositionLike[] = [
        {
          assetId: 'asset-xlm',
          assetCode: 'XLM',
          depositedUsd: 1000,
          borrowedUsd: 500,
          asset: { minCollateralRatio: 0.7 },
          isStale: true,
        },
      ];

      const result = computeHealthFactor(
        positions,
        {},
        {},
        { allowStale: false },
      );

      expect(result.isStale).toBe(true);
      expect(result.healthFactor).toBeNull();
      expect(result.stalePrices).toContain('XLM');
    });
  });
});
