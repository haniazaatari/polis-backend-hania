import dotenv from 'dotenv';
import pg from 'pg';

const { Pool } = pg;

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

export async function setupTestDb() {
  // Create test tables or seed test data
  await pool.query(`
    -- Create test tables or reset data
    TRUNCATE some_table CASCADE;
    INSERT INTO some_table (column1, column2) VALUES ('test1', 'test2');
  `);
}

export async function teardownTestDb() {
  // Clean up test data
  await pool.query(`
    TRUNCATE some_table CASCADE;
  `);
  await pool.end();
}
