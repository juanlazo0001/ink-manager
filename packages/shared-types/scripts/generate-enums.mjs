// Generates src/enums.generated.ts from apps/api/prisma/schema.prisma.
//
// WHY CODEGEN, and not a type import
// ----------------------------------
// The obvious alternative is for this package to `import type` Prisma's
// own generated enums from apps/api/generated/prisma/enums.ts. That does
// not work here, for two independent reasons:
//
//   1. apps/api/generated/ is GITIGNORED. It exists only after
//      `prisma generate` runs (apps/api's postinstall). A fresh clone
//      would fail to typecheck this package before install, and CI order
//      would start to matter.
//   2. This package is deliberately dependency-free and types-only --
//      apps/mobile bundles its SOURCE through Metro. Pointing it at
//      anything inside apps/api couples the mobile bundle's resolution
//      graph to the API's, which is exactly what shared-types exists to
//      avoid.
//
// schema.prisma, by contrast, IS committed and is the actual source of
// truth. Parsing it needs no Prisma runtime and no build order.
//
// Drift is caught, not merely discouraged: `--check` re-generates in
// memory and exits non-zero if the committed file differs. That runs as
// part of this package's own `typecheck` script, so the standard
// verification bar every session already runs will fail on drift.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA = join(here, '..', '..', '..', 'apps', 'api', 'prisma', 'schema.prisma');
const OUT = join(here, '..', 'src', 'enums.generated.ts');

// Which Prisma enums cross the wire and are therefore worth having here.
// `as` renames one to the name this package already exposed -- Prisma's
// LiabilityWaiverStatus appears on an appointment only as its waiver
// summary, where `WaiverStatus` reads better.
const WANTED = [
  { prisma: 'Role' },
  { prisma: 'ConversationType' },
  { prisma: 'MessageChannel' },
  { prisma: 'MessageDirection' },
  { prisma: 'InquiryStatus' },
  { prisma: 'AppointmentStatus' },
  { prisma: 'AppointmentType' },
  { prisma: 'LiabilityWaiverStatus', as: 'WaiverStatus' },
  { prisma: 'FlashReviewMode' },
  { prisma: 'FlashPieceStatus' },
  { prisma: 'NotificationType' },
];

function parseEnum(schema, name) {
  // Deliberately strict: the opening brace must be on the `enum` line, and
  // the block ends at the first line that is exactly `}`. Prisma's own
  // formatter guarantees both. Anything else should fail loudly rather
  // than silently produce a short enum -- which is the precise bug this
  // script exists to prevent.
  const start = schema.search(new RegExp(`^enum ${name} \{$`, 'm'));
  if (start === -1) throw new Error(`enum ${name} not found in schema.prisma`);
  const rest = schema.slice(start);
  const end = rest.search(/^\}$/m);
  if (end === -1) throw new Error(`enum ${name} is not terminated`);
  const body = rest.slice(rest.indexOf('\n') + 1, end);

  const values = body
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => /^[A-Z][A-Z0-9_]*$/.test(line));

  if (values.length === 0) throw new Error(`enum ${name} parsed to zero values`);
  return values;
}

function render(schema) {
  const banner = [
    '// GENERATED FILE -- DO NOT EDIT BY HAND.',
    '//',
    '// Source: apps/api/prisma/schema.prisma',
    '// Regenerate: npm run generate:enums --workspace=packages/shared-types',
    '//',
    '// Hand-retyping these is how apps/mobile shipped an InquiryStatus with',
    '// 11 of its 15 values (see PARITY-AUDIT.md). `npm run typecheck` in this',
    '// package re-derives them and fails if this file has drifted.',
    '',
  ].join('\n');

  const blocks = WANTED.map(({ prisma, as }) => {
    const name = as ?? prisma;
    const values = parseEnum(schema, prisma);
    const entries = values.map((v) => `  ${v}: '${v}',`).join('\n');
    const from = as ? `\n/** Prisma: \`${prisma}\`. */` : '';
    return `${from}\nexport const ${name} = {\n${entries}\n} as const;\nexport type ${name} = (typeof ${name})[keyof typeof ${name}];\n`;
  });

  return `${banner}${blocks.join('\n')}`;
}

const schema = readFileSync(SCHEMA, 'utf8');
const generated = render(schema);

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(OUT, 'utf8');
  } catch {
    console.error('enums.generated.ts is missing. Run: npm run generate:enums --workspace=packages/shared-types');
    process.exit(1);
  }
  // Normalized so a checkout with CRLF line endings does not read as drift.
  if (current.replace(/\r\n/g, '\n') !== generated.replace(/\r\n/g, '\n')) {
    console.error(
      'enums.generated.ts has DRIFTED from apps/api/prisma/schema.prisma.\n' +
        'Run: npm run generate:enums --workspace=packages/shared-types',
    );
    process.exit(1);
  }
  console.log('enums.generated.ts matches schema.prisma');
} else {
  writeFileSync(OUT, generated, 'utf8');
  const counts = WANTED.map(({ prisma, as }) => `${as ?? prisma}=${parseEnum(schema, prisma).length}`).join(' ');
  console.log(`wrote src/enums.generated.ts (${counts})`);
}
