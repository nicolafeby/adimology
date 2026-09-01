#!/usr/bin/env node

/**
 * Supabase Migration Runner
 * 
 * Runs SQL migration files from the supabase/ directory in sequential order.
 * Tracks executed migrations to prevent re-execution.
 * 
 * IMPORTANT: This script creates a helper SQL function to execute migrations.
 * On first run, it will set up the tracking table and helper function.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// Load .env.local if it exists (for local development)
const envPath = path.join(__dirname, '..', '.env.local');
try {
  const envContent = require('fs').readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([^#=]+?)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      // Remove optional quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.substring(1, value.length - 1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
} catch (e) {
  // .env.local might not exist, skip
}

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase');

// Validate environment variables
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Error: Missing required environment variables');
  console.error('   Required: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)');
  console.error('   Required: SUPABASE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)');
  process.exit(1);
}

// Initialize Supabase client
// Migrations only use PostgREST/RPC. Supplying an unused transport prevents
// supabase-js from requiring Node's native WebSocket implementation on Node 20.
class UnusedWebSocketTransport {}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  realtime: { transport: UnusedWebSocketTransport },
});

/**
 * Calculate MD5 checksum of a string
 */
function calculateChecksum(content) {
  return crypto.createHash('md5').update(content, 'utf8').digest('hex');
}

/**
 * Setup migration infrastructure (tracking table + helper function)
 */
async function setupMigrationInfrastructure() {
  console.log('📋 Setting up migration infrastructure...\n');
  
  const setupSQL = `
-- Create schema_migrations table for tracking
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  id SERIAL PRIMARY KEY,
  migration_name TEXT UNIQUE NOT NULL,
  executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  checksum TEXT,
  execution_time_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_name 
  ON public.schema_migrations(migration_name);

-- Create helper function to execute raw SQL
CREATE OR REPLACE FUNCTION public.exec_migration_sql(sql_query TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE sql_query;
END;
$$;

-- Raw migration SQL must never be callable through the public anon key.
REVOKE ALL ON FUNCTION public.exec_migration_sql(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exec_migration_sql(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.exec_migration_sql(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.exec_migration_sql(TEXT) TO service_role;

-- Make the new table/function visible to PostgREST immediately.
NOTIFY pgrst, 'reload schema';
  `;
  
  console.log('📝 Please execute the following SQL in your Supabase SQL Editor:');
  console.log('   (Go to your Supabase Dashboard → SQL Editor → New query)\n');
  console.log('─'.repeat(60));
  console.log(setupSQL);
  console.log('─'.repeat(60));
  console.log('\nOnce executed, press ENTER to continue...');
  
  // Wait for user confirmation in interactive mode
  // In CI/automated mode, we skip this
  const isAutomated = process.env.CI || process.env.NETLIFY;
  
  if (!isAutomated) {
    // Interactive mode - wait for user
    process.stdin.resume();
    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });
    process.stdin.pause();
  } else {
    console.log('\n⚙️  Automated mode detected - assuming setup is complete\n');
  }
}

/**
 * Check if migration infrastructure is set up
 */
async function checkInfrastructure() {
  // Check if schema_migrations table exists
  const { error: tableError } = await supabase
    .from('schema_migrations')
    .select('id')
    .limit(1);
  
  if (tableError && tableError.code === '42P01') {
    return false; // Table doesn't exist
  }
  
  // Check if exec_migration_sql function exists
  const { error: funcError } = await supabase
    .rpc('exec_migration_sql', { sql_query: 'SELECT 1' });
  
  if (funcError && (funcError.code === '42883' || funcError.message?.includes('function') || funcError.message?.includes('does not exist'))) {
    return false; // Function doesn't exist
  }
  
  return true; // All good
}

/**
 * Get list of already executed migrations
 */
async function getExecutedMigrations() {
  const { data, error } = await supabase
    .from('schema_migrations')
    .select('migration_name, checksum')
    .order('migration_name');

  if (error) {
    console.error('❌ Error fetching executed migrations:', error.message);
    process.exit(1);
  }

  return new Map((data || []).map(m => [m.migration_name, m.checksum]));
}

/**
 * Read and sort migration files from the migrations directory
 */
async function getMigrationFiles() {
  try {
    const files = await fs.readdir(MIGRATIONS_DIR);
    
    // Filter only .sql files and exclude README
    const sqlFiles = files.filter(f => f.endsWith('.sql') && !f.toLowerCase().includes('readme'));
    
    // Sort by numeric prefix (001, 002, etc.)
    sqlFiles.sort((a, b) => {
      const numA = parseInt(a.match(/^(\d+)/)?.[1] || '0');
      const numB = parseInt(b.match(/^(\d+)/)?.[1] || '0');
      return numA - numB;
    });
    
    return sqlFiles;
  } catch (error) {
    console.error('❌ Error reading migrations directory:', error.message);
    process.exit(1);
  }
}

/**
 * Execute a single migration file
 */
async function executeMigration(filename, content, checksum) {
  const startTime = Date.now();
  
  console.log(`  ⏳ Executing ${filename}...`);
  
  // Execute the SQL using our helper function
  const { error } = await supabase
    .rpc('exec_migration_sql', { sql_query: content });
  
  if (error) {
    console.error(`  ❌ Error executing ${filename}:`, error.message);
    throw error;
  }
  
  const executionTime = Date.now() - startTime;
  
  // Record the migration in schema_migrations table
  const { error: recordError } = await supabase
    .from('schema_migrations')
    .insert({
      migration_name: filename,
      checksum,
      execution_time_ms: executionTime
    });
  
  if (recordError) {
    console.error(`  ❌ Error recording migration ${filename}:`, recordError.message);
    throw recordError;
  }
  
  console.log(`  ✅ ${filename} completed (${executionTime}ms)`);
  return executionTime;
}

/**
 * Main migration runner
 */
async function runMigrations() {
  console.log('🚀 Supabase Migration Runner\n');
  
  // Check if infrastructure is set up
  const isSetup = await checkInfrastructure();
  
  if (!isSetup) {
    console.log('⚠️  Migration infrastructure not detected!\n');
    await setupMigrationInfrastructure();
    
    // Re-check after setup
    const isNowSetup = await checkInfrastructure();
    if (!isNowSetup) {
      const isAutomated = process.env.CI || process.env.NETLIFY;
      if (isAutomated) {
        console.warn('\n⚠️  Migration infrastructure missing. Skipping migrations for this build.');
        console.warn('   Please follow the SQL setup instructions in the logs above to enable automatic migrations.');
        process.exit(0); // Exit with 0 to allow build to continue
      } else {
        console.error('\n❌ Infrastructure setup incomplete.');
        console.error('   Please run the setup SQL in Supabase SQL Editor and try again.\n');
        process.exit(1);
      }
    }
  }
  
  console.log('✅ Migration infrastructure ready\n');
  
  // Get list of executed migrations
  const executedMigrations = await getExecutedMigrations();
  console.log(`📊 Previously executed: ${executedMigrations.size} migrations\n`);
  
  // Get list of migration files
  const migrationFiles = await getMigrationFiles();
  console.log(`📁 Found: ${migrationFiles.length} migration files\n`);
  
  // Find migrations that need to be run
  const pendingMigrations = [];
  
  for (const filename of migrationFiles) {
    const filePath = path.join(MIGRATIONS_DIR, filename);
    const content = await fs.readFile(filePath, 'utf8');
    const checksum = calculateChecksum(content);
    
    if (!executedMigrations.has(filename)) {
      pendingMigrations.push({ filename, content, checksum });
    } else {
      const existingChecksum = executedMigrations.get(filename);
      if (existingChecksum !== checksum) {
        console.warn(`⚠️  Warning: ${filename} has been modified`);
        console.warn(`   (checksum mismatch - skipping re-execution)\n`);
      }
    }
  }
  
  if (pendingMigrations.length === 0) {
    console.log('✨ All migrations up to date!\n');
    return;
  }
  
  console.log(`🔧 Running ${pendingMigrations.length} pending migrations:\n`);
  
  let totalTime = 0;
  let successCount = 0;
  
  for (const migration of pendingMigrations) {
    try {
      const executionTime = await executeMigration(
        migration.filename,
        migration.content,
        migration.checksum
      );
      totalTime += executionTime;
      successCount++;
    } catch (error) {
      console.error(`\n❌ Migration failed: ${migration.filename}`);
      console.error(`   Error: ${error.message}\n`);
      process.exit(1);
    }
  }
  
  console.log(`\n✨ Success! Executed ${successCount}/${pendingMigrations.length} migrations`);
  console.log(`   Total time: ${totalTime}ms\n`);
}

// Run migrations
runMigrations().catch(error => {
  console.error('\n💥 Unexpected error:', error.message);
  process.exit(1);
});
