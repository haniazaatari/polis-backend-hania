import {
  checkDeleteAuthorization,
  checkMetadataAccess,
  createMetadataQuestionForConversation,
  createOrUpdateMetadataAnswerForQuestion,
  deleteMetadataAnswerById,
  deleteMetadataQuestionAndAnswersById,
  getAllMetadataForConversation,
  getChoicesForConversationById,
  getMetadataAnswersForConversation,
  getMetadataQuestionsForConversation,
  getZidForMetadataAnswer,
  getZidForMetadataQuestion
} from '../services/metadata/metadataService.js';
import logger from '../utils/logger.js';

/**
 * Get metadata for a conversation
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @returns {Promise<void>}
 */
async function getMetadata(req, res) {
  const { zid, zinvite, suzinvite } = req.p;

  try {
    await checkMetadataAccess(zid, zinvite, suzinvite);

    const [questions, answers] = await Promise.all([
      getMetadataQuestionsForConversation(zid),
      getMetadataAnswersForConversation(zid)
    ]);

    res.status(200).json({
      questions,
      answers
    });
  } catch (err) {
    logger.error('Error getting metadata', err);
    res.status(500).json({
      error: err.message
    });
  }
}

/**
 * Get metadata choices for a conversation
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @returns {Promise<void>}
 */
async function getMetadataChoices(req, res) {
  const { zid } = req.p;

  try {
    const choices = await getChoicesForConversationById(zid);
    res.status(200).json(choices);
  } catch (err) {
    logger.error('Error getting metadata choices', err);
    res.status(500).json({
      error: err.message
    });
  }
}

/**
 * Get all metadata for a conversation
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @returns {Promise<void>}
 */
async function getAllMetadata(req, res) {
  const { zid } = req.p;

  try {
    const metadata = await getAllMetadataForConversation(zid);
    res.status(200).json(metadata);
  } catch (err) {
    logger.error('Error getting all metadata', err);
    res.status(500).json({
      error: err.message
    });
  }
}

/**
 * Create a metadata question
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @returns {Promise<void>}
 */
async function createQuestion(req, res) {
  const { zid, key } = req.p;

  try {
    const question = await createMetadataQuestionForConversation(zid, key);
    res.status(201).json(question);
  } catch (err) {
    logger.error('Error creating metadata question', err);
    res.status(500).json({
      error: err.message
    });
  }
}

/**
 * Create a metadata answer
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @returns {Promise<void>}
 */
async function createAnswer(req, res) {
  const { pmqid, zid, value } = req.p;

  try {
    const answer = await createOrUpdateMetadataAnswerForQuestion(pmqid, zid, value);
    res.status(201).json(answer);
  } catch (err) {
    logger.error('Error creating metadata answer', err);
    res.status(500).json({
      error: err.message
    });
  }
}

/**
 * Delete a metadata answer
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @returns {Promise<void>}
 */
async function deleteAnswer(req, res) {
  const { pmaid, uid } = req.p;

  try {
    const zid = await getZidForMetadataAnswer(pmaid);
    await checkDeleteAuthorization(zid, uid);
    await deleteMetadataAnswerById(pmaid);
    res.status(200).json({ status: 'success' });
  } catch (err) {
    logger.error('Error deleting metadata answer', err);
    res.status(500).json({
      error: err.message
    });
  }
}

/**
 * Delete a metadata question
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @returns {Promise<void>}
 */
async function deleteQuestion(req, res) {
  const { pmqid, uid } = req.p;

  try {
    const zid = await getZidForMetadataQuestion(pmqid);
    await checkDeleteAuthorization(zid, uid);
    await deleteMetadataQuestionAndAnswersById(pmqid);
    res.status(200).json({ status: 'success' });
  } catch (err) {
    logger.error('Error deleting metadata question', err);
    res.status(500).json({
      error: err.message
    });
  }
}

export { getMetadata, getMetadataChoices, getAllMetadata, createQuestion, createAnswer, deleteAnswer, deleteQuestion };
