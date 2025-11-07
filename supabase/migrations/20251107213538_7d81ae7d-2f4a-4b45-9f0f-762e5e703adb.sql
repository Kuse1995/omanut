-- Rename columns to be industry-neutral
ALTER TABLE companies 
  RENAME COLUMN seating_areas TO service_locations;

ALTER TABLE companies 
  RENAME COLUMN menu_or_offerings TO services;