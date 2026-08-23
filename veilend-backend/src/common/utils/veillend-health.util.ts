export interface VeilLendHealthResult {
  /** Infinity when there is no outstanding debt. */
  healthFactor: number;
  availableToBorrow: number;
}

/**
 * VeilLend protocol solvency math: collateral is valued against a single
 * protocol-wide minimum collateral ratio expressed in basis points (e.g.
 * 15000 = 150%), not a per-asset weight:
 *
 *   healthFactor      = (collateralValue * 10_000) / (borrowedValue * minCollateralRatioBps)
 *   availableToBorrow = max(0, collateralValue * 10_000 / minCollateralRatioBps - borrowedValue)
 *
 * A health factor below 1 means the position is eligible for liquidation.
 */
export function computeVeilLendHealth(
  collateralValue: number,
  borrowedValue: number,
  minCollateralRatioBps: number,
): VeilLendHealthResult {
  const maxBorrowable = (collateralValue * 10_000) / minCollateralRatioBps;
  const availableToBorrow = Math.max(0, maxBorrowable - borrowedValue);

  if (borrowedValue <= 0) {
    return { healthFactor: Infinity, availableToBorrow };
  }

  const healthFactor =
    (collateralValue * 10_000) / (borrowedValue * minCollateralRatioBps);

  return { healthFactor, availableToBorrow };
}
