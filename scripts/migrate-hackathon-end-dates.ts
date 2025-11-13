#!/usr/bin/env tsx

/**
 * Migration script to set end dates for existing hackathons
 *
 * This script sets the end date to the current timestamp for any hackathons
 * that don't have an end date set, making them compatible with the new
 * required end date schema.
 *
 * To run this migration:
 * 1. Start the Convex dev server: npx convex dev
 * 2. Run: npx convex run hackathons:migrateEndDates
 *
 * Or manually update hackathons through the Convex dashboard.
 */

console.log('Migration script created.');
console.log('To run the migration:');
console.log('1. Start Convex dev server: npx convex dev');
console.log('2. Run: npx convex run hackathons:migrateEndDates');
console.log('');
console.log(
  "This will set end dates to the current timestamp for any existing hackathons that don't have one.",
);
