import akismetLib from 'akismet';
import badwords from 'badwords';
import { google } from 'googleapis';
import Config from '../config.js';
import logger from './logger.js';
import { MPromise } from './metered.js';

// Initialize Akismet client
const serverUrl = Config.getServerNameWithProtocol();
const akismet = akismetLib.client({
  blog: serverUrl,
  apiKey: Config.akismetAntispamApiKey
});

// Verify Akismet API key
akismet.verifyKey((_err, verified) => {
  if (verified) {
    logger.silly('Akismet: API key successfully verified.');
  } else {
    logger.silly('Akismet: Unable to verify API key.');
  }
});

/**
 * Check if a comment contains bad words
 * @param {string} txt - The comment text to check
 * @returns {boolean} - True if the comment contains bad words
 */
function hasBadWords(txt) {
  const lowerTxt = txt.toLowerCase();
  const tokens = lowerTxt.split(' ');
  for (let i = 0; i < tokens.length; i++) {
    if (badwords[tokens[i]]) {
      return true;
    }
  }
  return false;
}

const GOOGLE_DISCOVERY_URL = 'https://commentanalyzer.googleapis.com/$discovery/rest?version=v1alpha1';

/**
 * Analyze a comment for toxicity using Google's Perspective API
 * @param {string} txt - The comment text to analyze
 * @returns {Promise<Object|null>} - The analysis result or null if analysis fails
 */
async function analyzeComment(txt) {
  try {
    if (!Config.googleJigsawPerspectiveApiKey) {
      return null;
    }

    const client = await google.discoverAPI(GOOGLE_DISCOVERY_URL);
    const analyzeRequest = {
      comment: {
        text: txt
      },
      requestedAttributes: {
        TOXICITY: {}
      }
    };

    const response = await client.comments.analyze({
      key: Config.googleJigsawPerspectiveApiKey,
      resource: analyzeRequest
    });

    return response.data;
  } catch (err) {
    logger.error('analyzeComment error', err);
    return null;
  }
}

/**
 * Check if a comment is spam using Akismet
 * @param {Object} options - Options for spam checking
 * @returns {Promise<boolean>} - True if the comment is spam
 */
function isSpam(options) {
  if (!Config.akismetAntispamApiKey) {
    return Promise.resolve(false);
  }

  return MPromise('isSpam', (resolve, reject) => {
    akismet.checkSpam(options, (err, spam) => {
      if (err) {
        logger.error('Error checking comment for spam with Akismet', err);
        reject(err);
      } else {
        resolve(spam);
      }
    });
  });
}

export { hasBadWords, analyzeComment, isSpam };
