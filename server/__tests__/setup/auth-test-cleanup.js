import dotenv from 'dotenv';
import pg from 'pg';

const { Pool } = pg;

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

/**
 * Clean up test users created during integration tests
 * @param {string} emailPattern - Pattern to match test user emails (e.g., 'test.user.%')
 */
export async function cleanupTestUsers(emailPattern = 'test.user.%') {
  try {
    // First get the user IDs to clean up
    const userResult = await pool.query('SELECT uid FROM users WHERE email LIKE $1', [emailPattern]);

    if (userResult.rows.length === 0) {
      console.log('No test users to clean up');
      return;
    }

    const userIds = userResult.rows.map((row) => row.uid);
    console.log(`Found ${userIds.length} test users to clean up`);

    // Begin transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Delete auth sessions
      await client.query('DELETE FROM auth_tokens WHERE uid = ANY($1)', [userIds]);

      // Delete password records
      await client.query('DELETE FROM jianiuevyew WHERE uid = ANY($1)', [userIds]);

      // Delete user records
      await client.query('DELETE FROM users WHERE uid = ANY($1)', [userIds]);

      await client.query('COMMIT');
      console.log(`Successfully cleaned up ${userIds.length} test users`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error during test user cleanup:', err);
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Failed to clean up test users:', err);
  }
}

/**
 * Close the database pool
 */
export async function closePool() {
  await pool.end();
  console.log('Database pool closed');
}
