import bcrypt from 'bcryptjs';
import { getPasswordHash, updatePassword as updateDbPassword } from '../../repositories/user/userRepository.js';
import logger from '../../utils/logger.js';

/**
 * Generate a hashed password using bcrypt
 * @param {string} password - The plain text password
 * @returns {Promise<string>} - The hashed password
 */
async function generateHashedPassword(password) {
  try {
    const salt = await bcrypt.genSalt(12);
    return await bcrypt.hash(password, salt);
  } catch (error) {
    logger.error('Error generating hashed password', error);
    throw new Error('polis_err_hashing_password');
  }
}

/**
 * Generate a hashed password using bcrypt (callback version for backward compatibility)
 * @param {string} password - The plain text password
 * @param {Function} callback - Callback function(err, hashedPassword)
 */
function generateHashedPasswordWithCallback(password, callback) {
  generateHashedPassword(password)
    .then((hashedPassword) => callback(null, hashedPassword))
    .catch((error) => {
      logger.error('Error generating hashed password', error);
      callback('polis_err_hashing_password');
    });
}

/**
 * Check if a password matches the stored hash for a user
 * @param {number} uid - The user ID
 * @param {string} password - The plain text password to check
 * @returns {Promise<string|null>} - 'ok' if password matches, null if user not found, 0 if password doesn't match
 */
async function checkPassword(uid, password) {
  try {
    // Get the password hash from the repository
    const hashedPassword = await getPasswordHash(uid);

    if (!hashedPassword) {
      return null; // User not found or no password set
    }

    // Compare the provided password with the stored hash
    const result = await bcrypt.compare(password, hashedPassword);
    return result ? 'ok' : 0;
  } catch (error) {
    logger.error('Error checking password', error);
    throw error;
  }
}

/**
 * Verify a password against a provided hash
 * @param {string} password - The plain text password
 * @param {string} hash - The password hash to compare against
 * @returns {Promise<boolean>} - True if password matches, false otherwise
 */
async function verifyPassword(password, hash) {
  try {
    return await bcrypt.compare(password, hash);
  } catch (error) {
    logger.error('Error verifying password', error);
    throw error;
  }
}

/**
 * Update a user's password
 * @param {number} uid - The user ID
 * @param {string} hashedPassword - The hashed password
 * @returns {Promise<Object>} - The updated user
 */
async function updatePassword(uid, hashedPassword) {
  try {
    return await updateDbPassword(uid, hashedPassword);
  } catch (error) {
    logger.error('Error updating password', error);
    throw error;
  }
}

export { generateHashedPassword, generateHashedPasswordWithCallback, checkPassword, verifyPassword, updatePassword };
