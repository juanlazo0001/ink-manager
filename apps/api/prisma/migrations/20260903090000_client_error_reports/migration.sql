-- Package BK: browser crash reports.
--
-- `prisma migrate diff --from-config-datasource` diffs the LIVE database and
-- so also emitted `DROP TABLE "migrations"` for a third-party library's own
-- migration tracker that lives in `public` but is not in schema.prisma. That
-- drop was removed by hand -- see CLAUDE.md, which documents this as recurring
-- for every migration generated this way. Everything below is additive.

-- CreateTable
CREATE TABLE "ClientErrorReport" (
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "componentStack" TEXT,
    "boundary" TEXT,
    "url" TEXT,
    "userAgent" TEXT,
    "viewport" TEXT,
    "appCommit" TEXT,
    "appBuiltAt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "studioId" TEXT,
    "userId" TEXT,

    CONSTRAINT "ClientErrorReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientErrorReport_createdAt_idx" ON "ClientErrorReport"("createdAt");

-- CreateIndex
CREATE INDEX "ClientErrorReport_appCommit_idx" ON "ClientErrorReport"("appCommit");

-- AddForeignKey
ALTER TABLE "ClientErrorReport" ADD CONSTRAINT "ClientErrorReport_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientErrorReport" ADD CONSTRAINT "ClientErrorReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
