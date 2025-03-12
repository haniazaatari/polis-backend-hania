import crypto from 'crypto';
import Config from '../../config.js';
import { hexToStr, strToHex } from '../../utils/common.js';
import logger from '../../utils/logger.js';

/**
 * Encrypt text using AES-256-CTR
 * @param {string} text - The text to encrypt
 * @returns {string} - The encrypted text
 */
function encrypt(text) {
  try {
    const algorithm = 'aes-256-ctr';
    const password = Config.encryptionPassword;
    const cipher = crypto.createCipher(algorithm, password);
    let crypted = cipher.update(text, 'utf8', 'hex');
    crypted += cipher.final('hex');
    return crypted;
  } catch (error) {
    logger.error('Error encrypting text', error);
    throw new Error('polis_err_encryption');
  }
}

/**
 * Decrypt text using AES-256-CTR
 * @param {string} text - The encrypted text
 * @returns {string} - The decrypted text
 */
function decrypt(text) {
  try {
    const algorithm = 'aes-256-ctr';
    const password = Config.encryptionPassword;
    const decipher = crypto.createDecipher(algorithm, password);
    let dec = decipher.update(text, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch (error) {
    logger.error('Error decrypting text', error);
    throw new Error('polis_err_decryption');
  }
}

/**
 * Decode encoded parameters from URL
 * @param {string} encodedStringifiedJson - The encoded JSON string
 * @returns {Object} - The decoded parameters
 * @throws {Error} - If the encoded string has an invalid format
 */
function decodeParams(encodedStringifiedJson) {
  if (typeof encodedStringifiedJson === 'string' && !encodedStringifiedJson.match(/^\/?ep1_/)) {
    throw new Error('wrong encoded params prefix');
  }

  try {
    let processedParam = encodedStringifiedJson;
    if (encodedStringifiedJson[0] === '/') {
      processedParam = encodedStringifiedJson.slice(5);
    } else {
      processedParam = encodedStringifiedJson.slice(4);
    }

    const stringifiedJson = hexToStr(processedParam);
    return JSON.parse(stringifiedJson);
  } catch (error) {
    logger.error('Error decoding parameters', error);
    throw new Error('invalid_encoded_params');
  }
}

/**
 * Encode parameters for URL
 * @param {Object} params - The parameters to encode
 * @returns {string} - The encoded parameters
 */
function encodeParams(params) {
  try {
    const stringifiedJson = JSON.stringify(params);
    const hex = strToHex(stringifiedJson);
    return `ep1_${hex}`;
  } catch (error) {
    logger.error('Error encoding parameters', error);
    throw new Error('invalid_params_for_encoding');
  }
}

export { encrypt, decrypt, decodeParams, encodeParams };
