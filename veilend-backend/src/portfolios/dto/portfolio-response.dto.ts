/** A single on-chain Horizon balance line (native XLM or a trustline). */
export class BalanceDto {
  /** 'XLM' for native, otherwise the trustline's asset code (e.g. 'USDC'). Kept for client compatibility. */
  readonly asset: string;
  readonly assetCode: string;
  readonly issuer: string | null;
  readonly balance: number;
}

export class ProtocolAssetPositionDto {
  readonly assetId: string;
  readonly assetCode: string;
  readonly assetSymbol: string;
  readonly amount: number;
  readonly amountUsd: number;
}

/** VeilLend protocol positions and solvency metrics, distinct from wallet `balances`. */
export class ProtocolSummaryDto {
  readonly depositedAssets: ProtocolAssetPositionDto[];
  readonly borrowedAssets: ProtocolAssetPositionDto[];
  readonly collateralValue: number;
  readonly borrowedValue: number;
  /** healthFactor = collateralValue × 10_000 / (borrowedValue × minCollateralRatioBps); Infinity when there is no debt. */
  readonly healthFactor: number;
  readonly availableToBorrow: number;
  readonly minCollateralRatioBps: number;
}

export class PortfolioResponseDto {
  readonly walletAddress: string;
  /** Native XLM balance; mirrors the 'XLM' entry in `balances` for client convenience. */
  readonly balance: number;
  /** Wallet's on-chain Horizon balances (native XLM + trustlines) — NOT protocol collateral/debt. */
  readonly balances: BalanceDto[];
  /** VeilLend protocol collateral/debt/health, computed from indexer Position rows. */
  readonly protocol: ProtocolSummaryDto;
  /** Mirrors `protocol.collateralValue`; kept at top level for existing clients. */
  readonly collateralValue: number;
  /** Mirrors `protocol.borrowedValue`; kept at top level for existing clients. */
  readonly borrowedValue: number;
  /** Mirrors `protocol.availableToBorrow`; kept at top level for existing clients. */
  readonly availableToBorrow: number;
  /** Mirrors `protocol.healthFactor`; kept at top level for existing clients. */
  readonly healthFactor: number;
}
