-- This migration moves Appointment from a single `serviceId` column to a
-- many-to-many `AppointmentService` join table, so one appointment can have
-- several services. Existing appointments are backfilled into the join
-- table BEFORE the old column is dropped, so no historical data is lost.
--
-- Note: this project previously ran on `prisma db push` with no migration
-- history (see docker-entrypoint.sh), so the foreign key created for the
-- old `Appointment.serviceId` column may not use Prisma's default naming
-- convention. We look it up dynamically instead of assuming a fixed name.

-- CreateTable
CREATE TABLE `AppointmentService` (
    `appointmentId` VARCHAR(191) NOT NULL,
    `serviceId` VARCHAR(191) NOT NULL,
    `priceCents` INTEGER NOT NULL,
    `durationMin` INTEGER NOT NULL,

    INDEX `AppointmentService_serviceId_idx`(`serviceId`),
    PRIMARY KEY (`appointmentId`, `serviceId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Backfill: one row per existing appointment, from its current single service
INSERT INTO `AppointmentService` (`appointmentId`, `serviceId`, `priceCents`, `durationMin`)
SELECT `id`, `serviceId`, `priceCents`, `durationMin`
FROM `Appointment`
WHERE `serviceId` IS NOT NULL;

-- Drop the old FK on Appointment.serviceId, whatever it happens to be named
SET @fk_name := (
  SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'Appointment'
    AND COLUMN_NAME = 'serviceId'
    AND REFERENCED_TABLE_NAME IS NOT NULL
  LIMIT 1
);
SET @drop_fk_sql := IF(@fk_name IS NOT NULL,
  CONCAT('ALTER TABLE `Appointment` DROP FOREIGN KEY `', @fk_name, '`'),
  'SELECT 1'
);
PREPARE stmt FROM @drop_fk_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- AlterTable
ALTER TABLE `Appointment` DROP COLUMN `serviceId`;

-- AddForeignKey
ALTER TABLE `AppointmentService` ADD CONSTRAINT `AppointmentService_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `Appointment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AppointmentService` ADD CONSTRAINT `AppointmentService_serviceId_fkey` FOREIGN KEY (`serviceId`) REFERENCES `Service`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
