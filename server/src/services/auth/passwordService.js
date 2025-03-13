import bcrypt from 'bcryptjs';
import { getPasswordHash, storePasswordHash, updatePasswordHash } from '../../repositories/auth/authRepository.js';
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
 * Update a user's password
 * @param {number} uid - The user ID
 * @param {string} password - The new plain text password
 * @returns {Promise<Object>} - The updated user
 */
async function updatePassword(uid, password) {
  try {
    const hashedPassword = await generateHashedPassword(password);

    // Check if user already has a password hash
    const existingHash = await getPasswordHash(uid);

    if (existingHash) {
      // Update existing password hash
      await updatePasswordHash(uid, hashedPassword);
    } else {
      // Store new password hash
      await storePasswordHash(uid, hashedPassword);
    }

    return { success: true };
  } catch (error) {
    logger.error('Error updating password', error);
    throw error;
  }
}

/**
 * Check if a password matches the stored hash for a user
 * @param {number} uid - The user ID
 * @param {string} password - The plain text password to check
 * @returns {Promise<string|null>} - 'ok' if password matches, null if user not found, 0 if password doesn't match
 */
async function checkPassword(uid, password) {
  try {
    logger.debug(`Checking password for user ${uid}`);

    // Get the password hash from the auth repository (jianiuevyew table)
    const hashedPassword = await getPasswordHash(uid);
    logger.debug(`Password hash for user ${uid}: ${hashedPassword ? 'found' : 'not found'}`);

    if (!hashedPassword) {
      logger.debug(`No password hash found for user ${uid}`);
      return null; // User not found or no password set
    }

    // Compare the provided password with the stored hash
    logger.debug(`Comparing password with hash for user ${uid}`);
    const result = await bcrypt.compare(password, hashedPassword);
    logger.debug(`Password comparison result for user ${uid}: ${result ? 'match' : 'no match'}`);
    return result ? 'ok' : 0;
  } catch (error) {
    logger.error(`Error checking password for user ${uid}:`, error);
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
    logger.debug(`Verifying password against hash: ${hash.substring(0, 10)}...`);
    const result = await bcrypt.compare(password, hash);
    logger.debug(`Password verification result: ${result ? 'match' : 'no match'}`);
    return result;
  } catch (error) {
    logger.error(`Error verifying password: ${error.message}`, error);
    throw error;
  }
}

export { generateHashedPassword, updatePassword, checkPassword, verifyPassword };
