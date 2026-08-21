-- Expands the public landing page: address + contact email/phone on Salon,
-- a per-service image, a per-stylist photo, and a new Testimonial table.
-- All new Salon/Service/Stylist columns are nullable and Testimonial is a
-- brand-new table — no existing data is touched.

-- AlterTable
ALTER TABLE `Salon`
  ADD COLUMN `address` VARCHAR(300) NULL,
  ADD COLUMN `contactEmail` VARCHAR(200) NULL,
  ADD COLUMN `contactPhone` VARCHAR(40) NULL;

-- AlterTable
ALTER TABLE `Service`
  ADD COLUMN `imageUrl` VARCHAR(500) NULL;

-- AlterTable
ALTER TABLE `Stylist`
  ADD COLUMN `photoUrl` VARCHAR(500) NULL;

-- CreateTable
CREATE TABLE `Testimonial` (
    `id` VARCHAR(191) NOT NULL,
    `salonId` VARCHAR(191) NOT NULL,
    `clientName` VARCHAR(120) NOT NULL,
    `text` TEXT NOT NULL,
    `rating` INTEGER NOT NULL,
    `serviceName` VARCHAR(120) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Testimonial_salonId_createdAt_idx`(`salonId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Testimonial` ADD CONSTRAINT `Testimonial_salonId_fkey` FOREIGN KEY (`salonId`) REFERENCES `Salon`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
