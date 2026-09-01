/*
 * A dev session for the parity harness: one JWT, plus the ids the
 * manifest's screen paths interpolate.
 *
 * Run through `tsx` from `apps/api`, not `node` from the repo root. The
 * generated Prisma client in this project is TYPESCRIPT
 * (`apps/api/generated/prisma`, per schema.prisma's own `output`), so a
 * plain node import cannot load it and a `dist/` build is not guaranteed
 * to exist in a fresh worktree. tsx is already an apps/api dependency,
 * which keeps "runs from a clean tree" true.
 *
 * It reads the SAME dev database both clients are pointed at. A harness
 * that compared web against one dataset and mobile against another would
 * report content differences as design drift.
 */
import "dotenv/config";
import jwt from "jsonwebtoken";
import { PrismaClient } from "../../apps/api/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const wanted = (process.argv[2] ?? "owner").toUpperCase() === "ARTIST" ? "ARTIST" : "OWNER";

/*
 * Everything below sits in `main()` rather than at the top level: tsx
 * resolves this file as CJS (apps/api has no `"type": "module"`), and
 * esbuild refuses top-level await under that output format.
 */
async function main() {

  /*
   * The studio with the most inquiries, so screens have something on them.
   * An empty list on one side and an empty list on the other agree about
   * nothing, and would report as parity.
   */
  const studio = await prisma.studio.findFirst({
    where: { inquiries: { some: {} } },
    orderBy: { inquiries: { _count: "desc" } },
    select: { id: true, name: true },
  });
  if (!studio) throw new Error("no studio with inquiries in this database");

  const user = await prisma.user.findFirst({
    where: { studioId: studio.id, role: wanted as never, isActive: true },
    select: { id: true, email: true, role: true },
  });
  if (!user) throw new Error(`no active ${wanted} in studio ${studio.name}`);

  const [inquiry, client, conversation] = await Promise.all([
    prisma.inquiry.findFirst({ where: { studioId: studio.id }, select: { id: true }, orderBy: { updatedAt: "desc" } }),
    prisma.client.findFirst({ where: { studioId: studio.id }, select: { id: true } }),
    prisma.conversation.findFirst({ where: { studioId: studio.id }, select: { id: true } }),
  ]);

  console.log(
    JSON.stringify({
      email: user.email,
      role: user.role,
      studio: studio.name,
      token: jwt.sign(
        { userId: user.id, studioId: studio.id, role: user.role },
        process.env.JWT_SECRET!,
        { expiresIn: "3h" },
      ),
      ids: {
        studioId: studio.id,
        inquiryId: inquiry?.id ?? "",
        clientId: client?.id ?? "",
        conversationId: conversation?.id ?? "",
      },
    }),
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
