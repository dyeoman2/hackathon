#!/usr/bin/env tsx

/**
 * Migration script to set submission deadlines for existing hackathons
 *
 * This script sets the submission deadline to the current timestamp for any hackathons
 * that don't have a submission deadline set, making them compatible with the new
 * required submission deadline schema.
 *
 * To run this migration:
 * 1. Start the Convex dev server: npx convex dev
 * 2. Run: npx convex run hackathons:migrateSubmissionDeadlines
 *
 * Or manually update hackathons through the Convex dashboard.
 */

console.log('Migration script created.');
console.log('To run the migration:');
console.log('1. Start Convex dev server: npx convex dev');
console.log('2. Run: npx convex run hackathons:migrateSubmissionDeadlines');
console.log('');
console.log(
  "This will set submission deadlines to the current timestamp for any existing hackathons that don't have one.",
);
