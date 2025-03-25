import {
  createDummyUser as dbCreateDummyUser,
  createUser as dbCreateUser,
  getUserByEmail as dbGetUserByEmail,
  getUserById as dbGetUserById,
  updateUser as dbUpdateUser
} from '../../db/users.js';

/**
 * Get user by email
 * @param {string} email - The user's email
 * @returns {Promise<Object|null>} - The user object or null if not found
 */
async function getUserByEmail(email) {
  return dbGetUserByEmail(email);
}

/**
 * Get user by ID
 * @param {number} uid - The user ID
 * @returns {Promise<Object|null>} - The user object or null if not found
 */
async function getUserById(uid) {
  return dbGetUserById(uid);
}

/**
 * Create a new user
 * @param {Object} user - User data
 * @returns {Promise<Object>} Created user with uid
 */
async function createUser(user) {
  return dbCreateUser(user);
}

/**
 * Create a dummy user (minimal user record)
 * @returns {Promise<number>} - The created user ID
 */
async function createDummyUser() {
  return dbCreateDummyUser();
}

/**
 * Update a user's information
 * @param {number} uid - The user ID
 * @param {Object} fields - Fields to update
 * @returns {Promise<Object>} - The update result
 */
async function updateUser(uid, fields) {
  return dbUpdateUser(uid, fields);
}

export { getUserByEmail, getUserById, createUser, createDummyUser, updateUser };
