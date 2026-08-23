import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { WalletService } from './../src/wallet/wallet.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { StellarAccountService } from './../src/stellar/stellar-account.service';

// Two syntactically valid Stellar Ed25519 public keys.
const OWN_WALLET = 'GBJEI2M7C3VCWLNGMVIUCA5MNNJICYGKRPS75OZHNUCX33RTRJNQK6MH';
const OTHER_WALLET = 'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37';

interface FakeUser {
  id: string;
  walletAddress: string;
}

interface FakePosition {
  assetId: string;
  asset: {
    code: string;
    symbol: string;
    decimals: number;
    minCollateralRatio: number | null;
  };
  depositedRaw: bigint;
  borrowedRaw: bigint;
  depositedUsd: number;
  borrowedUsd: number;
}

interface HorizonLookupResult {
  success: boolean;
  data?: { balances: unknown[] };
  error?: { message: string; code?: string };
}

const HORIZON_BALANCES_FIXTURE = [
  { asset_type: 'native', balance: '1234.5000000' },
  {
    asset_type: 'credit_alphanum4',
    asset_code: 'USDC',
    asset_issuer: 'GISSUERFAKE',
    balance: '10.0000000',
  },
];

// Mutable stub for StellarAccountService so the e2e run never depends on a
// real Horizon network call. Reassigning `.lookupAccountHorizon` per-test
// (Nest keeps this exact object as the provider instance for `useValue`)
// lets a single app instance exercise both the happy path and the
// unresolvable-account path without re-bootstrapping the module.
const mockStellarAccountService = {
  lookupAccountHorizon: (_accountId: string): Promise<HorizonLookupResult> =>
    Promise.resolve({
      success: true,
      data: { balances: HORIZON_BALANCES_FIXTURE },
    }),
};

// A minimal in-memory Prisma stand-in covering exactly what the auth flow,
// PortfoliosController and TransactionsController touch, so these specs
// don't need a live Postgres connection.
interface FakeSession {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  ip?: string;
  userAgent?: string;
}

interface FakeWalletNonce {
  id: string;
  walletAddress: string;
  nonce: string;
  used: boolean;
  expiresAt: Date;
}

interface FakeJtiRegistryRow {
  jti: string;
  userId: string;
  sessionId: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
}

class FakePrismaService {
  private users = new Map<string, FakeUser>();
  // Keyed by session id (Prisma's real primary key); the auth flow also
  // looks sessions up by their hashed `token`, handled via a linear scan
  // below since this store is only ever a handful of rows in tests.
  private sessions = new Map<string, FakeSession>();
  private walletNonces: FakeWalletNonce[] = [];
  private jtiRegistry_ = new Map<string, FakeJtiRegistryRow>();
  private idCounter = 0;
  // Seeded per-user VeilLend positions, keyed by userId. Empty by default so
  // most tests exercise the "no VeilLend activity yet" path.
  positionsByUserId = new Map<string, FakePosition[]>();

  private nextId(): string {
    this.idCounter += 1;
    return `id-${this.idCounter}`;
  }

  // PortfoliosRepository runs its reads through this so it can be exercised
  // the same way as against real Postgres, without a live transaction.
  withRepeatableRead = <T>(fn: (db: this) => Promise<T>): Promise<T> =>
    fn(this);

  withSerializable = <T>(fn: (db: this) => Promise<T>): Promise<T> => fn(this);

  /** Test helper: seeds indexer Position rows for a wallet's user record. */
  async seedPositions(
    walletAddress: string,
    positions: FakePosition[],
  ): Promise<void> {
    const user = await this.user.upsert({ where: { walletAddress } });
    this.positionsByUserId.set(user.id, positions);
  }

  user = {
    upsert: ({
      where,
    }: {
      where: { walletAddress: string };
    }): Promise<FakeUser> => {
      const existing = this.users.get(where.walletAddress);
      if (existing) return Promise.resolve(existing);
      const created = { id: this.nextId(), walletAddress: where.walletAddress };
      this.users.set(where.walletAddress, created);
      return Promise.resolve(created);
    },
    findUnique: ({
      where,
    }: {
      where: { walletAddress: string };
    }): Promise<FakeUser | null> => {
      return Promise.resolve(this.users.get(where.walletAddress) ?? null);
    },
  };

  session = {
    create: ({
      data,
    }: {
      data: FakeSession | Omit<FakeSession, 'id'>;
    }): Promise<FakeSession> => {
      const record: FakeSession = { id: this.nextId(), ...data };
      this.sessions.set(record.id, record);
      return Promise.resolve(record);
    },
    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<FakeSession>;
    }): Promise<FakeSession> => {
      const record = this.sessions.get(where.id);
      if (!record) throw new Error(`FakeSession ${where.id} not found`);
      Object.assign(record, data);
      return Promise.resolve(record);
    },
    findUnique: ({
      where,
    }: {
      where: { id?: string; token?: string };
    }): Promise<(FakeSession & { user?: FakeUser }) | null> => {
      const session = where.id
        ? this.sessions.get(where.id)
        : [...this.sessions.values()].find((s) => s.token === where.token);
      if (!session) return Promise.resolve(null);
      const user = [...this.users.values()].find(
        (u) => u.id === session.userId,
      );
      return Promise.resolve({ ...session, user });
    },
  };

  walletNonce = {
    updateMany: ({
      where,
      data,
    }: {
      where: {
        walletAddress: string;
        nonce?: string;
        used?: boolean;
        expiresAt?: { gt: Date };
      };
      data: Partial<FakeWalletNonce>;
    }): Promise<{ count: number }> => {
      let count = 0;
      for (const n of this.walletNonces) {
        if (n.walletAddress !== where.walletAddress) continue;
        if (where.nonce !== undefined && n.nonce !== where.nonce) continue;
        if (where.used !== undefined && n.used !== where.used) continue;
        if (where.expiresAt && !(n.expiresAt > where.expiresAt.gt)) continue;
        Object.assign(n, data);
        count += 1;
      }
      return Promise.resolve({ count });
    },
    create: ({
      data,
    }: {
      data: Omit<FakeWalletNonce, 'id' | 'used'> & { used?: boolean };
    }): Promise<FakeWalletNonce> => {
      const record: FakeWalletNonce = {
        id: this.nextId(),
        used: false,
        ...data,
      };
      this.walletNonces.push(record);
      return Promise.resolve(record);
    },
    findFirst: ({
      where,
    }: {
      where: { walletAddress: string; nonce?: string };
    }): Promise<FakeWalletNonce | null> =>
      Promise.resolve(
        this.walletNonces.find(
          (n) =>
            n.walletAddress === where.walletAddress &&
            (where.nonce === undefined || n.nonce === where.nonce),
        ) ?? null,
      ),
    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<FakeWalletNonce>;
    }): Promise<FakeWalletNonce> => {
      const record = this.walletNonces.find((n) => n.id === where.id);
      if (!record) throw new Error(`FakeWalletNonce ${where.id} not found`);
      Object.assign(record, data);
      return Promise.resolve(record);
    },
  };

  jtiRegistry = {
    create: ({
      data,
    }: {
      data: Omit<FakeJtiRegistryRow, 'revokedAt'>;
    }): Promise<FakeJtiRegistryRow> => {
      const record: FakeJtiRegistryRow = { revokedAt: null, ...data };
      this.jtiRegistry_.set(record.jti, record);
      return Promise.resolve(record);
    },
    findUnique: ({
      where,
    }: {
      where: { jti: string };
    }): Promise<FakeJtiRegistryRow | null> =>
      Promise.resolve(this.jtiRegistry_.get(where.jti) ?? null),
    updateMany: (): Promise<{ count: number }> => Promise.resolve({ count: 0 }),
    deleteMany: (): Promise<{ count: number }> => Promise.resolve({ count: 0 }),
  };

  refreshToken = {
    create: (): Promise<Record<string, never>> => Promise.resolve({}),
    findUnique: (): Promise<null> => Promise.resolve(null),
    findMany: (): Promise<unknown[]> => Promise.resolve([]),
    updateMany: (): Promise<{ count: number }> => Promise.resolve({ count: 0 }),
    deleteMany: (): Promise<{ count: number }> => Promise.resolve({ count: 0 }),
  };

  authAuditLog = {
    create: (): Promise<Record<string, never>> => Promise.resolve({}),
    findMany: (): Promise<unknown[]> => Promise.resolve([]),
  };

  admin = {
    findUnique: (): Promise<null> => Promise.resolve(null),
  };

  position = {
    findMany: ({
      where,
    }: {
      where: { userId: string };
    }): Promise<FakePosition[]> =>
      Promise.resolve(this.positionsByUserId.get(where.userId) ?? []),
  };

  transactionHistory = {
    findMany: (): Promise<unknown[]> => Promise.resolve([]),
    count: (): Promise<number> => Promise.resolve(0),
  };
}

describe('Portfolios & Transactions (e2e)', () => {
  let app: INestApplication<App>;
  let fakePrisma: FakePrismaService;

  beforeEach(async () => {
    fakePrisma = new FakePrismaService();
    mockStellarAccountService.lookupAccountHorizon = (_accountId: string) =>
      Promise.resolve({
        success: true,
        data: { balances: HORIZON_BALANCES_FIXTURE },
      });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(WalletService)
      .useValue({ verifySignature: () => true })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .overrideProvider(StellarAccountService)
      .useValue(mockStellarAccountService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  async function login(walletAddress: string): Promise<string> {
    const nonceRes = await request(app.getHttpServer())
      .post('/auth/nonce')
      .send({ walletAddress });
    // Every response is wrapped by the global TransformInterceptor into
    // { success, data }, so the actual payload lives under `.data`.
    const nonceBody = nonceRes.body as { data: { nonce: string } };

    const verifyRes = await request(app.getHttpServer())
      .post('/auth/verify')
      .send({
        walletAddress,
        nonce: nonceBody.data.nonce,
        signature: 'stubbed',
      });
    const verifyBody = verifyRes.body as { data: { accessToken: string } };

    return verifyBody.data.accessToken;
  }

  it('rejects unauthenticated requests to /portfolios/:walletAddress', async () => {
    const res = await request(app.getHttpServer()).get(
      `/portfolios/${OWN_WALLET}`,
    );
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated requests to /transactions/:walletAddress', async () => {
    const res = await request(app.getHttpServer()).get(
      `/transactions/${OWN_WALLET}`,
    );
    expect(res.status).toBe(401);
  });

  it('returns a single response envelope for /portfolios/:walletAddress', async () => {
    const token = await login(OWN_WALLET);

    const res = await request(app.getHttpServer())
      .get(`/portfolios/${OWN_WALLET}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    const data = body.data as Record<string, unknown>;
    // Exactly one envelope: the inner payload must not itself look wrapped.
    expect(data.success).toBeUndefined();
    expect(data.walletAddress).toBe(OWN_WALLET);
  });

  it('combines indexer-backed VeilLend positions with (mocked) Horizon balances, keeping the two namespaces separate', async () => {
    const token = await login(OWN_WALLET);
    await fakePrisma.seedPositions(OWN_WALLET, [
      {
        assetId: 'asset-xlm',
        asset: {
          code: 'XLM',
          symbol: 'XLM',
          decimals: 7,
          minCollateralRatio: null,
        },
        depositedRaw: 5000_0000000n,
        borrowedRaw: 0n,
        depositedUsd: 2500, // 5000 XLM @ $0.50
        borrowedUsd: 0,
      },
      {
        assetId: 'asset-usdc',
        asset: {
          code: 'USDC',
          symbol: 'USDC',
          decimals: 7,
          minCollateralRatio: null,
        },
        depositedRaw: 0n,
        borrowedRaw: 2000_0000000n,
        depositedUsd: 0,
        borrowedUsd: 2000, // 2000 USDC @ $1.00
      },
    ]);

    const res = await request(app.getHttpServer())
      .get(`/portfolios/${OWN_WALLET}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    const data = body.data as Record<string, unknown>;

    // Wallet holdings (from the mocked Horizon lookup) are still surfaced,
    // and are untouched by the protocol math below.
    expect(data.balances).toEqual([
      { asset: 'XLM', assetCode: 'XLM', issuer: null, balance: 1234.5 },
      { asset: 'USDC', assetCode: 'USDC', issuer: 'GISSUERFAKE', balance: 10 },
    ]);

    // Protocol totals come from the seeded indexer Position rows, not from
    // the wallet's native XLM balance (1234.5) — the two must never mix.
    const protocol = data.protocol as Record<string, unknown>;
    expect(protocol.collateralValue).toBe(2500);
    expect(protocol.borrowedValue).toBe(2000);
    expect(protocol.depositedAssets).toHaveLength(1);
    expect(protocol.borrowedAssets).toHaveLength(1);
    // healthFactor = (2500 * 10_000) / (2000 * minCollateralRatioBps)
    const healthFactor = protocol.healthFactor as number;
    const minCollateralRatioBps = protocol.minCollateralRatioBps as number;
    expect(healthFactor).toBeCloseTo(
      (2500 * 10_000) / (2000 * minCollateralRatioBps),
      6,
    );
  });

  it('returns 404 for a wallet unresolvable on both Horizon and the indexer, without leaking a raw Horizon exception', async () => {
    const token = await login(OWN_WALLET);
    mockStellarAccountService.lookupAccountHorizon = () =>
      Promise.resolve({
        success: false,
        error: { message: 'Not Found', code: '404' },
      });

    const res = await request(app.getHttpServer())
      .get(`/portfolios/${OWN_WALLET}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    const body = res.body as { success: boolean; error: { message: string } };
    expect(body.success).toBe(false);
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message).not.toMatch(/Horizon/i);
  });

  it('returns a single response envelope for /transactions/:walletAddress', async () => {
    const token = await login(OWN_WALLET);

    const res = await request(app.getHttpServer())
      .get(`/transactions/${OWN_WALLET}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.success).toBe(true);
    const data = body.data as Record<string, unknown>;
    expect(data.success).toBeUndefined();
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.meta).toBeDefined();
  });

  it("returns 403 when a non-admin requests another wallet's portfolio", async () => {
    const token = await login(OWN_WALLET);

    const res = await request(app.getHttpServer())
      .get(`/portfolios/${OTHER_WALLET}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("returns 403 when a non-admin requests another wallet's transactions", async () => {
    const token = await login(OWN_WALLET);

    const res = await request(app.getHttpServer())
      .get(`/transactions/${OTHER_WALLET}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});
