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
-- IMPORTANT ordering: the new composite index is created BEFORE the old
-- indexes are dropped. Both salonId and stylistId are foreign key columns,
-- and InnoDB refuses to drop the last index covering an FK column ("Cannot
-- drop index ...: needed in a foreign key constraint") — the new index's
-- leading column already covers the FK, so create it first and there's
-- never a moment with no covering index.

-- CreateIndex
CREATE INDEX `BusinessHour_salonId_dayOfWeek_idx` ON `BusinessHour`(`salonId`, `dayOfWeek`);

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

-- Drop the old salonId-only index (superseded by the composite index created above)
SET @idx_name := (
  SELECT INDEX_NAME FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'BusinessHour'
    AND NON_UNIQUE = 1 AND INDEX_NAME <> 'PRIMARY'
    AND INDEX_NAME <> 'BusinessHour_salonId_dayOfWeek_idx'
  LIMIT 1
);
SET @sql := IF(@idx_name IS NOT NULL,
  CONCAT('ALTER TABLE `BusinessHour` DROP INDEX `', @idx_name, '`'),
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- CreateIndex
CREATE INDEX `StylistHour_stylistId_dayOfWeek_idx` ON `StylistHour`(`stylistId`, `dayOfWeek`);

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

-- Drop the old stylistId-only index (superseded by the composite index created above)
SET @idx_name := (
  SELECT INDEX_NAME FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'StylistHour'
    AND NON_UNIQUE = 1 AND INDEX_NAME <> 'PRIMARY'
    AND INDEX_NAME <> 'StylistHour_stylistId_dayOfWeek_idx'
  LIMIT 1
);
SET @sql := IF(@idx_name IS NOT NULL,
  CONCAT('ALTER TABLE `StylistHour` DROP INDEX `', @idx_name, '`'),
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
