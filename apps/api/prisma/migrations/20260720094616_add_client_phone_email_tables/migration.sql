-- CreateTable
CREATE TABLE "ClientPhone" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "label" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT NOT NULL,

    CONSTRAINT "ClientPhone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientEmail" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "label" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT NOT NULL,

    CONSTRAINT "ClientEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientPhone_clientId_phone_key" ON "ClientPhone"("clientId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "ClientEmail_clientId_email_key" ON "ClientEmail"("clientId", "email");

-- AddForeignKey
ALTER TABLE "ClientPhone" ADD CONSTRAINT "ClientPhone_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientEmail" ADD CONSTRAINT "ClientEmail_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: every existing Client with a non-null phone/email gets a
-- corresponding primary alias row, so the new tables start in sync with
-- the scalar fields every existing consumer still reads.
INSERT INTO "ClientPhone" ("id", "phone", "isPrimary", "clientId", "createdAt")
SELECT gen_random_uuid()::text, "phone", true, "id", CURRENT_TIMESTAMP
FROM "Client"
WHERE "phone" IS NOT NULL AND "phone" <> '';

INSERT INTO "ClientEmail" ("id", "email", "isPrimary", "clientId", "createdAt")
SELECT gen_random_uuid()::text, lower(trim("email")), true, "id", CURRENT_TIMESTAMP
FROM "Client"
WHERE "email" IS NOT NULL AND "email" <> '';
