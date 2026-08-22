-- Pure-additive: adds nullable GPS coordinates to Salon. No existing data
-- touched; `address` keeps its existing values and meaning (now populated
-- from the map pin instead of typed freehand, but still a plain label).
ALTER TABLE `Salon`
  ADD COLUMN `latitude` DOUBLE NULL,
  ADD COLUMN `longitude` DOUBLE NULL;
