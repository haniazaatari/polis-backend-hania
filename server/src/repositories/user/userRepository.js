import { queryP, queryP_readOnly } from '../../db/pg-query.js';
import { sql_users } from '../../db/sql.js';
import logger from '../../utils/logger.js';

/**
 * Get user by email
 * @param {string} email - The user's email
 * @returns {Promise<Object|null>} - The user object or null if not found
 */
async function getUserByEmail(email) {
  const results = await queryP_readOnly('SELECT * FROM users WHERE email = ($1);', [email]);

  return results.length ? results[0] : null;
}

/**
 * Get user by ID
 * @param {number} uid - The user ID
 * @returns {Promise<Object|null>} - The user object or null if not found
 */
async function getUserById(uid) {
  const results = await queryP_readOnly('SELECT * FROM users WHERE uid = ($1);', [uid]);

  return results.length ? results[0] : null;
}

/**
 * Create a new user
 * @param {Object} user - User data
 * @returns {Promise<Object>} Created user with uid
 */
async function createUser(user) {
  try {
    const fields = ['email', 'hname', 'is_owner'];
    const values = [user.email, user.hname, true];
    const placeholders = ['$1', '$2', '$3'];
    let paramCount = 3;

    // Add optional fields
    if (user.zinvite) {
      fields.push('zinvite');
      values.push(user.zinvite);
      placeholders.push(`$${++paramCount}`);
    }

    if (user.oinvite) {
      fields.push('oinvite');
      values.push(user.oinvite);
      placeholders.push(`$${++paramCount}`);
    }

    if (user.site_id) {
      fields.push('site_id');
      values.push(user.site_id);
      placeholders.push(`$${++paramCount}`);
    }

    const query = `
      INSERT INTO users (${fields.join(', ')}) 
      VALUES (${placeholders.join(', ')}) 
      RETURNING *;
    `;

    const results = await queryP(query, values);
    return results[0];
  } catch (error) {
    logger.error('Error creating user', error);
    throw error;
  }
}

/**
 * Create a dummy user (minimal user record)
 * @returns {Promise<number>} - The created user ID
 */
async function createDummyUser() {
  try {
    const results = await queryP('INSERT INTO users (created) VALUES (now()) RETURNING uid;');
    return results[0].uid;
  } catch (error) {
    logger.error('Error creating dummy user', error);
    throw new Error('polis_err_create_empty_user');
  }
}

/**
 * Update a user's information
 * @param {number} uid - The user ID
 * @param {Object} fields - Fields to update
 * @returns {Promise<Object>} - The update result
 */
async function updateUser(uid, fields) {
  const q = sql_users.update(fields).where(sql_users.uid.equals(uid));
  return queryP(q.toString(), []);
}

export { getUserByEmail, getUserById, createUser, createDummyUser, updateUser };
