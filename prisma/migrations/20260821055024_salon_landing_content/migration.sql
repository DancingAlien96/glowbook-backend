-- Adds public-landing-page content: a longer "about" text + social/contact
-- links on Salon, and a new SalonPhoto table for the work-portfolio gallery.
-- All new Salon columns are nullable and SalonPhoto is a brand-new table —
-- no existing data is touched, so there's nothing to backfill.

-- AlterTable
ALTER TABLE `Salon`
  ADD COLUMN `aboutText` TEXT NULL,
  ADD COLUMN `instagramUrl` VARCHAR(300) NULL,
  ADD COLUMN `facebookUrl` VARCHAR(300) NULL,
  ADD COLUMN `whatsappContact` VARCHAR(40) NULL;

-- CreateTable
CREATE TABLE `SalonPhoto` (
    `id` VARCHAR(191) NOT NULL,
    `salonId` VARCHAR(191) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `caption` VARCHAR(160) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SalonPhoto_salonId_createdAt_idx`(`salonId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SalonPhoto` ADD CONSTRAINT `SalonPhoto_salonId_fkey` FOREIGN KEY (`salonId`) REFERENCES `Salon`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
