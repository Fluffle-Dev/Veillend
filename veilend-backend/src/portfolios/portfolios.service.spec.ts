/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PortfoliosService } from './portfolios.service';
import { PortfoliosRepository } from './portfolios.repository';
import { PrismaService } from '../prisma/prisma.service';
import { StellarAccountService } from '../stellar/stellar-account.service';
import { ProtocolService } from '../protocol/protocol.service';

const WALLET = 'GBJEI2M7C3VCWLNGMVIUCA5MNNJICYGKRPS75OZHNUCX33RTRJNQK6MH';

function position(overrides: Record<string, unknown> = {}) {
  return {
    assetId: 'asset-usdc',
    asset: {
      code: 'USDC',
      symbol: 'USDC',
      decimals: 7,
      minCollateralRatio: 0.8,
    },
    depositedRaw: 0n,
    borrowedRaw: 0n,
    depositedUsd: 0,
    borrowedUsd: 0,
    ...overrides,
  };
}

describe('PortfoliosService', () => {
  let service: PortfoliosService;

  const mockPortfoliosRepository = {
    getVeilLendPortfolio: jest.fn(),
  };

  const mockStellarAccountService = {
    lookupAccountHorizon: jest.fn(),
  };

  const mockProtocolService = {
    getMinCollateralRatioBps: jest.fn().mockReturnValue(15_000), // 150%
  };

  const mockPrismaService = {
    withSerializable: jest.fn(async (fn: (db: unknown) => Promise<unknown>) =>
      fn(mockPrismaService),
    ),
    user: { findUnique: jest.fn() },
    position: { upsert: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfoliosService,
        { provide: PortfoliosRepository, useValue: mockPortfoliosRepository },
        { provide: StellarAccountService, useValue: mockStellarAccountService },
        { provide: ProtocolService, useValue: mockProtocolService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<PortfoliosService>(PortfoliosService);
    jest.clearAllMocks();
    mockProtocolService.getMinCollateralRatioBps.mockReturnValue(15_000);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns 404 when the wallet resolves on neither Horizon nor the indexer', async () => {
    mockStellarAccountService.lookupAccountHorizon.mockResolvedValue({
      success: false,
      error: { message: 'Not Found', code: '404' },
    });
    mockPortfoliosRepository.getVeilLendPortfolio.mockResolvedValue({});

    await expect(service.getPortfolio(WALLET)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('computes healthFactor and availableToBorrow using the protocol-wide MCR formula (5000 XLM @ $0.50 deposited, 2000 USDC @ $1.00 borrowed, 150% MCR)', async () => {
    mockStellarAccountService.lookupAccountHorizon.mockResolvedValue({
      success: true,
      data: { balances: [] },
    });
    mockPortfoliosRepository.getVeilLendPortfolio.mockResolvedValue({
      positions: [
        position({
          assetId: 'asset-xlm',
          asset: { code: 'XLM', symbol: 'XLM', decimals: 7 },
          depositedRaw: 5000_0000000n,
          depositedUsd: 2500, // 5000 XLM * $0.50
        }),
        position({
          assetId: 'asset-usdc',
          borrowedRaw: 2000_0000000n,
          borrowedUsd: 2000, // 2000 USDC * $1.00
        }),
      ],
      collateralValue: 2500,
      borrowedValue: 2000,
    });

    const result = await service.getPortfolio(WALLET);

    expect(result.collateralValue).toBe(2500);
    expect(result.borrowedValue).toBe(2000);
    // (2500 * 10_000) / (2000 * 15_000) = 25,000,000 / 30,000,000 = 0.8333...
    expect(result.healthFactor).toBeCloseTo(2500 / 2000 / (15_000 / 10_000), 6);
    expect(result.healthFactor).toBeCloseTo(0.8333333, 5);
    expect(result.protocol.healthFactor).toBe(result.healthFactor);
    expect(result.protocol.minCollateralRatioBps).toBe(15_000);
  });

  it('keeps wallet balances and protocol collateral/debt in distinct namespaces', async () => {
    mockStellarAccountService.lookupAccountHorizon.mockResolvedValue({
      success: true,
      data: {
        balances: [
          { asset_type: 'native', balance: '1234.5000000' },
          {
            asset_type: 'credit_alphanum4',
            asset_code: 'USDC',
            asset_issuer: 'GISSUER',
            balance: '10.0000000',
          },
        ],
      },
    });
    mockPortfoliosRepository.getVeilLendPortfolio.mockResolvedValue({
      positions: [
        position({
          assetId: 'asset-xlm',
          asset: { code: 'XLM', symbol: 'XLM', decimals: 7 },
          depositedRaw: 100_0000000n,
          depositedUsd: 50,
        }),
      ],
      collateralValue: 50,
      borrowedValue: 0,
    });

    const result = await service.getPortfolio(WALLET);

    expect(result.balances).toEqual([
      { asset: 'XLM', assetCode: 'XLM', issuer: null, balance: 1234.5 },
      { asset: 'USDC', assetCode: 'USDC', issuer: 'GISSUER', balance: 10 },
    ]);
    // Wallet's native XLM balance (1234.5) must never leak into the
    // protocol collateral figure (50) — they are unrelated.
    expect(result.collateralValue).toBe(50);
    expect(result.protocol.collateralValue).toBe(50);
    expect(result.healthFactor).toBe(Infinity);
  });

  it('returns an empty protocol section (not a 404) for a wallet with no VeilLend positions but a resolvable Horizon account', async () => {
    mockStellarAccountService.lookupAccountHorizon.mockResolvedValue({
      success: true,
      data: { balances: [{ asset_type: 'native', balance: '100.0000000' }] },
    });
    mockPortfoliosRepository.getVeilLendPortfolio.mockResolvedValue({});

    const result = await service.getPortfolio(WALLET);

    expect(result.collateralValue).toBe(0);
    expect(result.borrowedValue).toBe(0);
    expect(result.healthFactor).toBe(Infinity);
    expect(result.protocol.depositedAssets).toEqual([]);
    expect(result.protocol.borrowedAssets).toEqual([]);
    expect(result.balances).toHaveLength(1);
  });

  it('clamps availableToBorrow to 0 when already borrowed past the max under the current MCR', async () => {
    mockStellarAccountService.lookupAccountHorizon.mockResolvedValue({
      success: true,
      data: { balances: [] },
    });
    mockPortfoliosRepository.getVeilLendPortfolio.mockResolvedValue({
      positions: [position({ depositedUsd: 100, borrowedUsd: 200 })],
      collateralValue: 100,
      borrowedValue: 200,
    });

    const result = await service.getPortfolio(WALLET);

    expect(result.availableToBorrow).toBe(0);
  });

  it('returns the full per-asset position list unpaginated for a wallet with more than 10 positions', async () => {
    mockStellarAccountService.lookupAccountHorizon.mockResolvedValue({
      success: true,
      data: { balances: [] },
    });
    const positions = Array.from({ length: 15 }, (_, i) =>
      position({
        assetId: `asset-${i}`,
        asset: { code: `A${i}`, symbol: `A${i}`, decimals: 7 },
        depositedRaw: 10_0000000n,
        depositedUsd: 10,
      }),
    );
    mockPortfoliosRepository.getVeilLendPortfolio.mockResolvedValue({
      positions,
      collateralValue: 150,
      borrowedValue: 0,
    });

    const result = await service.getPortfolio(WALLET);

    expect(result.protocol.depositedAssets).toHaveLength(15);
  });
});
