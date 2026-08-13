-- Package: theme defaults. Editorial Gold becomes the canonical default
-- for every new studio; onyx-lime and the other presets remain fully
-- real, OWNER-selectable options in Settings, just no longer the
-- fallback before Settings is ever touched.
ALTER TABLE "StudioSettings" ALTER COLUMN "themePreset" SET DEFAULT 'editorial-gold';
