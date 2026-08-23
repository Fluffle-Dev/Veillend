-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'CONFIRMED', 'ORPHANED');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('DRAFT', 'SIGNED', 'SENT', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'ORPHANED');

-- CreateTable
CREATE TABLE "UserDeposit" (
    "id" TEXT NOT NULL,
    "userWallet" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "amountStroops" BIGINT NOT NULL,
    "txHash" TEXT NOT NULL,
    "ledgerSeq" INTEGER NOT NULL,
    "confirmationsRequired" INTEGER NOT NULL DEFAULT 5,
    "confirmationsSeen" INTEGER NOT NULL DEFAULT 0,
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creditedAt" TIMESTAMP(3),

    CONSTRAINT "UserDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WithdrawalRequest" (
    "id" TEXT NOT NULL,
    "userWallet" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "amountStroops" BIGINT NOT NULL,
    "destinationAddress" TEXT NOT NULL,
    "destinationTag" TEXT,
    "whitelistApproved" BOOLEAN NOT NULL DEFAULT false,
    "whitelistEntryAddedAt" TIMESTAMP(3),
    "timelockUntil" TIMESTAMP(3),
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'DRAFT',
    "xdr" TEXT NOT NULL DEFAULT '',
    "txHash" TEXT,
    "feeChargedStroops" BIGINT,
    "confirmationsRequired" INTEGER NOT NULL DEFAULT 5,
    "confirmationsSeen" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "WithdrawalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WithdrawNonce" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "withdrawalRequestId" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WithdrawNonce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddressWhitelist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "label" TEXT,
    "timelockUntil" TIMESTAMP(3),
    "isInstantApproved" BOOLEAN NOT NULL DEFAULT false,
    "instantLimitUsd" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "AddressWhitelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetWithdrawalConfig" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "minConfirmations" INTEGER NOT NULL DEFAULT 5,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetWithdrawalConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserDeposit_txHash_key" ON "UserDeposit"("txHash");

-- CreateIndex
CREATE INDEX "UserDeposit_userWallet_idx" ON "UserDeposit"("userWallet");

-- CreateIndex
CREATE INDEX "UserDeposit_userId_idx" ON "UserDeposit"("userId");

-- CreateIndex
CREATE INDEX "UserDeposit_assetId_idx" ON "UserDeposit"("assetId");

-- CreateIndex
CREATE INDEX "UserDeposit_status_idx" ON "UserDeposit"("status");

-- CreateIndex
CREATE INDEX "UserDeposit_txHash_idx" ON "UserDeposit"("txHash");

-- CreateIndex
CREATE INDEX "UserDeposit_ledgerSeq_idx" ON "UserDeposit"("ledgerSeq");

-- CreateIndex
CREATE INDEX "UserDeposit_createdAt_idx" ON "UserDeposit"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawalRequest_txHash_key" ON "WithdrawalRequest"("txHash");

-- CreateIndex
CREATE INDEX "WithdrawalRequest_userWallet_idx" ON "WithdrawalRequest"("userWallet");

-- CreateIndex
CREATE INDEX "WithdrawalRequest_userId_idx" ON "WithdrawalRequest"("userId");

-- CreateIndex
CREATE INDEX "WithdrawalRequest_assetId_idx" ON "WithdrawalRequest"("assetId");

-- CreateIndex
CREATE INDEX "WithdrawalRequest_status_idx" ON "WithdrawalRequest"("status");

-- CreateIndex
CREATE INDEX "WithdrawalRequest_txHash_idx" ON "WithdrawalRequest"("txHash");

-- CreateIndex
CREATE INDEX "WithdrawalRequest_createdAt_idx" ON "WithdrawalRequest"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawNonce_nonce_key" ON "WithdrawNonce"("nonce");

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawNonce_withdrawalRequestId_key" ON "WithdrawNonce"("withdrawalRequestId");

-- CreateIndex
CREATE INDEX "WithdrawNonce_nonce_idx" ON "WithdrawNonce"("nonce");

-- CreateIndex
CREATE INDEX "WithdrawNonce_used_idx" ON "WithdrawNonce"("used");

-- CreateIndex
CREATE UNIQUE INDEX "AddressWhitelist_userId_address_key" ON "AddressWhitelist"("userId", "address");

-- CreateIndex
CREATE INDEX "AddressWhitelist_userId_idx" ON "AddressWhitelist"("userId");

-- CreateIndex
CREATE INDEX "AddressWhitelist_address_idx" ON "AddressWhitelist"("address");

-- CreateIndex
CREATE UNIQUE INDEX "AssetWithdrawalConfig_assetId_key" ON "AssetWithdrawalConfig"("assetId");

-- CreateIndex
CREATE INDEX "AssetWithdrawalConfig_assetId_idx" ON "AssetWithdrawalConfig"("assetId");

-- AddForeignKey
ALTER TABLE "UserDeposit" ADD CONSTRAINT "UserDeposit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDeposit" ADD CONSTRAINT "UserDeposit_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "WithdrawalRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "WithdrawalRequest_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithdrawNonce" ADD CONSTRAINT "WithdrawNonce_withdrawalRequestId_fkey" FOREIGN KEY ("withdrawalRequestId") REFERENCES "WithdrawalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddressWhitelist" ADD CONSTRAINT "AddressWhitelist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetWithdrawalConfig" ADD CONSTRAINT "AssetWithdrawalConfig_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
