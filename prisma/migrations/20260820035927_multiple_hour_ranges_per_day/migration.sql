-- Allow more than one open/close range per day (e.g. 09:00-13:00 and
-- 15:00-19:00 for a lunch break), for both salon-wide BusinessHour and
-- per-stylist StylistHour. Purely a constraint change — no rows are
-- touched, so there's nothing to backfill and no data-loss risk.
--
-- As with the earlier migration, this project ran on `prisma db push`
-- before we started tracking real migrations, so index/constraint names
-- may not match Prisma's default convention exactly. Look them up
-- dynamically instead of assuming a fixed name.
--
-- We only drop the UNIQUE constraint (the actual one-row-per-day rule) and
-- ADD a new composite index alongside the existing single-column one — we
-- deliberately do NOT drop that old single-column index. MySQL 8's InnoDB
-- won't treat an index created earlier in the *same* migration transaction
-- as valid FK coverage for a later DROP INDEX in that same transaction
-- ("Cannot drop index ...: needed in a foreign key constraint", even though
-- the replacement index already exists by then) — this sidesteps that
-- entirely. A harmless redundant single-column index on a tiny table isn't
-- worth the risk of relying on undocumented same-transaction DDL ordering.

-- Drop the old one-row-per-day unique constraint on BusinessHour
SET @idx_name := (
  SELECT INDEX_NAME FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'BusinessHour'
    AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY'
  LIMIT 1
);
SET @sql := IF(@idx_name IS NOT NULL,
  CONCAT('ALTER TABLE `BusinessHour` DROP INDEX `', @idx_name, '`'),
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- CreateIndex (only if it doesn't already exist from a previous partial attempt)
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'BusinessHour'
    AND INDEX_NAME = 'BusinessHour_salonId_dayOfWeek_idx'
);
SET @sql := IF(@idx_exists = 0,
  'CREATE INDEX `BusinessHour_salonId_dayOfWeek_idx` ON `BusinessHour`(`salonId`, `dayOfWeek`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Drop the old one-row-per-day unique constraint on StylistHour
SET @idx_name := (
  SELECT INDEX_NAME FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'StylistHour'
    AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY'
  LIMIT 1
);
SET @sql := IF(@idx_name IS NOT NULL,
  CONCAT('ALTER TABLE `StylistHour` DROP INDEX `', @idx_name, '`'),
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- CreateIndex (only if it doesn't already exist from a previous partial attempt)
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'StylistHour'
    AND INDEX_NAME = 'StylistHour_stylistId_dayOfWeek_idx'
);
SET @sql := IF(@idx_exists = 0,
  'CREATE INDEX `StylistHour_stylistId_dayOfWeek_idx` ON `StylistHour`(`stylistId`, `dayOfWeek`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
