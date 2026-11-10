-- CreateTable
CREATE TABLE "IntegrationCredential" (
    "provider" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "accountEmail" TEXT NOT NULL,
    "connectedByUserId" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("provider")
);
