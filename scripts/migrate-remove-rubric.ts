#!/usr/bin/env tsx
/**
 * Migration script to remove rubric field from existing hackathons
 * Run this after Convex starts: npx tsx scripts/migrate-remove-rubric.ts
 */

import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';

const CONVEX_URL = process.env.VITE_CONVEX_URL || process.env.CONVEX_URL;

if (!CONVEX_URL) {
  console.error('Error: VITE_CONVEX_URL or CONVEX_URL environment variable is required');
  process.exit(1);
}

async function runMigration() {
  const client = new ConvexHttpClient(CONVEX_URL);
  
  console.log('Running migration to remove rubric field from hackathons...');
  
  try {
    const result = await client.mutation(api.hackathons.migrateRemoveRubric, {});
    console.log('✅ Migration completed:', result.message);
    
    console.log('\n⚠️  IMPORTANT: After migration completes, remove the rubric field from convex/schema.ts');
    console.log('   Change: rubric: v.optional(v.string()), // Temporary: will be removed after migration');
    console.log('   To: (remove the line entirely)');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();

