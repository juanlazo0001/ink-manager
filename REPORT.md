# Production backfill — repair malformed ShortLink URLs

Single session, targeting PRODUCTION directly via `apps/api/.env.production`. Data-only fix — no application code changes, nothing to commit for the fix itself.

**Context:** the prior session's short-link fix corrected `resolvePublicAppUrl()`/`resolveApiPublicUrl()` (via a new `ensureScheme()` helper) going forward, but every `ShortLink` row created before that fix still had the old malformed (schemeless) `targetUrl` stored. This session repaired the existing data.

## 1. Backup

No `pg_dump`/`psql`/Docker available in this environment (confirmed absent). With the user's explicit sign-off, took a full logical backup instead: a Prisma script connected to production and dumped every row from all 28 tables to timestamped JSON.

- File (moved out of the git-tracked repo after capture, since it contains real client PII): session scratchpad, `prod-backup-2026-07-21T02-54-44-567Z.json`
- Size: 4,345,207 bytes (4.14 MB)
- Contents: 222 rows across 28 tables, including all `ShortLink` rows at time of backup (9 rows, matching the pre-backfill state)
- Spot-checked as genuine production data: studio name "Black Hive Ink", includes `rTP3uwyI`

## 2. Independent verification

Confirmed the exact schema/column holding the malformed data: `ShortLink.targetUrl`. Queried all rows and classified each by scheme presence (`/^https?:\/\//i`):

```
Total ShortLink rows: 9
Y9nlzjo5 | scheme-present: false | ink-manager.up.railway.app/estimate/8e0e08f4e8886408fbcf1644fcbf83c9039325d3c7ad39f4c71dc85172b0f5e1
uUf0tU1J | scheme-present: false | ink-manager.up.railway.app/gift-card/qx4vxnJFOCFSUkZexDlThA
lslmSy7Z | scheme-present: false | ink-manager.up.railway.app/inquiry/black-hive-ink
T5nnwW2h | scheme-present: false | ink-manager.up.railway.app/inquiry/black-hive-ink?draft=583b26e1e5c7e37ef5b6c6686851c13d429f36d058bb0ad6d0a9f9c6feea7c02
YB6ijeUz | scheme-present: false | ink-manager.up.railway.app/estimate/3317ad67564f366410f9ff84cb02acb18068222a03fa0fab2f84808bc4fb7b9c
rTP3uwyI | scheme-present: false | ink-manager.up.railway.app/inquiry/black-hive-ink?draft=13ce0736a86a6bd8f847528246fb2a0b02cf2f0ea5557b888310df6b63dc948a
kOjPKE5Q | scheme-present: true  | https://ink-manager.up.railway.app/estimate/dda570284829f681a5e66cc0a0007ebf783e1a878cd3ee3e92f7bed8d1abb590
u941wZGy | scheme-present: true  | https://ink-manager.up.railway.app/gift-card/qx4vxnJFOCFSUkZexDlThA
FkhYRC7K | scheme-present: true  | https://ink-manager.up.railway.app/inquiry/black-hive-ink

Malformed (schemeless) row count: 6
```

## 3. Plan presented, "go" received

Exact SQL executed, matching `ensureScheme()`'s normalization precisely (prepend `https://` only to rows not already starting with `http://` or `https://`):

```sql
BEGIN;

UPDATE "ShortLink"
SET "targetUrl" = 'https://' || "targetUrl"
WHERE "targetUrl" NOT ILIKE 'http://%'
  AND "targetUrl" NOT ILIKE 'https://%';

COMMIT;
```

Run inside a Prisma `$transaction`. Previewed as affecting exactly 6 rows before execution; user confirmed "go".

## 4. Execution and verification

`$executeRawUnsafe` reported **6 rows updated** — exact match with the preview.

Re-queried immediately after (13 rows now present — 4 new `ShortLink` rows had been created by live production traffic between the backup/preview and execution; all 4 were already well-formed and confirmed untouched):

- **All 6 previously-malformed rows** (`Y9nlzjo5`, `uUf0tU1J`, `lslmSy7Z`, `T5nnwW2h`, `YB6ijeUz`, `rTP3uwyI`) now start with `https://`, and each new value matches exactly `https://` + the original stored value (verified programmatically, not just visually).
- **All rows that were already correct** (`kOjPKE5Q`, `u941wZGy`, `FkhYRC7K`, plus the 4 new arrivals `ZO3MK21G`, `fG26I5Fj`, `LhmBGAwa`, `K47DY0Cr`) are byte-for-byte unchanged.
- **Still-malformed count after the update: 0.**

Before → after for the reported row and two others:

| Code | Before | After |
|---|---|---|
| `rTP3uwyI` | `ink-manager.up.railway.app/inquiry/black-hive-ink?draft=13ce0736a86a6bd8f847528246fb2a0b02cf2f0ea5557b888310df6b63dc948a` | `https://ink-manager.up.railway.app/inquiry/black-hive-ink?draft=13ce0736a86a6bd8f847528246fb2a0b02cf2f0ea5557b888310df6b63dc948a` |
| `Y9nlzjo5` | `ink-manager.up.railway.app/estimate/8e0e08f4e8886408fbcf1644fcbf83c9039325d3c7ad39f4c71dc85172b0f5e1` | `https://ink-manager.up.railway.app/estimate/8e0e08f4e8886408fbcf1644fcbf83c9039325d3c7ad39f4c71dc85172b0f5e1` |
| `uUf0tU1J` | `ink-manager.up.railway.app/gift-card/qx4vxnJFOCFSUkZexDlThA` | `https://ink-manager.up.railway.app/gift-card/qx4vxnJFOCFSUkZexDlThA` |

**`rTP3uwyI` confirmed**: `targetUrl` is now `https://ink-manager.up.railway.app/inquiry/black-hive-ink?draft=13ce0736a86a6bd8f847528246fb2a0b02cf2f0ea5557b888310df6b63dc948a` — a complete, correctly-schemed URL.

## Cleanup

- Scratch scripts (`scratch-prod-backup.ts`, `scratch-prod-inspect-shortlinks.ts`, `scratch-prod-backfill.ts`) deleted from `apps/api/`.
- Backup JSON (contains real client PII) moved out of the git-tracked repo into the session's local scratchpad directory, never staged/committed.
- No application code changed this session; nothing to commit for the fix itself.
