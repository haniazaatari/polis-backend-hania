import Translate from '@google-cloud/translate';
import Config from '../../config.js';
import logger from '../../utils/logger.js';

// Initialize translation client if API should be used
const useTranslateApi = Config.shouldUseTranslationAPI;
const translateClient = useTranslateApi ? Translate() : null;

/**
 * Translate a string to a target language
 * @param {string} text - Text to translate
 * @param {string} targetLang - Target language code
 * @returns {Promise<string|null>} - Translated text or null if translation is disabled
 */
async function translateString(text, targetLang) {
  if (!useTranslateApi) {
    return null;
  }

  try {
    const results = await translateClient.translate(text, targetLang);
    return results[0]; // The first element is the translated text
  } catch (error) {
    logger.error('Error translating string', error);
    throw error;
  }
}

/**
 * Detect the language of a string
 * @param {string} text - Text to detect language for
 * @returns {Promise<Object>} - Language detection result
 */
async function detectLanguage(text) {
  if (!useTranslateApi) {
    return [
      {
        confidence: null,
        language: null
      }
    ];
  }

  try {
    return await translateClient.detect(text);
  } catch (error) {
    logger.error('Error detecting language', error);
    throw error;
  }
}

/**
 * Check if translation API is enabled
 * @returns {boolean} - Whether translation API is enabled
 */
function isTranslationEnabled() {
  return useTranslateApi;
}

export { translateString, detectLanguage, isTranslationEnabled };
