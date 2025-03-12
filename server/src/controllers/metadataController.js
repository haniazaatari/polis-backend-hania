import {
  checkDeleteAuthorization,
  checkMetadataAccess,
  createMetadataQuestion,
  createOrUpdateMetadataAnswer,
  deleteMetadataAnswer,
  deleteMetadataQuestionAndAnswers,
  getAllMetadata,
  getChoicesForConversation,
  getMetadataAnswers,
  getMetadataQuestions,
  getZidForAnswer,
  getZidForQuestion
} from '../services/metadata/metadataService.js';
import { fail, finishArray, finishOne } from '../utils/responseHandlers.js';

/**
 * Handle DELETE request for metadata questions
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const handleDeleteMetadataQuestion = async (req, res) => {
  const uid = req.p.uid;
  const pmqid = req.p.pmqid;

  try {
    // Get the conversation ID for the question
    const zid = await getZidForQuestion(pmqid);

    // Check if the user is authorized to delete the question
    await checkDeleteAuthorization(zid, uid);

    // Delete the question and its answers
    await deleteMetadataQuestionAndAnswers(pmqid);

    res.status(200).end();
  } catch (err) {
    if (err.message === 'polis_err_get_zid_for_question') {
      fail(res, 500, 'polis_err_delete_participant_metadata_questions_zid', err);
    } else if (err.message === 'polis_err_delete_metadata_auth') {
      fail(res, 403, 'polis_err_delete_participant_metadata_questions_auth', err);
    } else {
      fail(res, 500, 'polis_err_delete_participant_metadata_question', err);
    }
  }
};

/**
 * Handle DELETE request for metadata answers
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const handleDeleteMetadataAnswer = async (req, res) => {
  const uid = req.p.uid;
  const pmaid = req.p.pmaid;

  try {
    // Get the conversation ID for the answer
    const zid = await getZidForAnswer(pmaid);

    // Check if the user is authorized to delete the answer
    await checkDeleteAuthorization(zid, uid);

    // Delete the answer
    await deleteMetadataAnswer(pmaid);

    res.status(200).end();
  } catch (err) {
    if (err.message === 'polis_err_get_zid_for_answer') {
      fail(res, 500, 'polis_err_delete_participant_metadata_answer_zid', err);
    } else if (err.message === 'polis_err_delete_metadata_auth') {
      fail(res, 403, 'polis_err_delete_participant_metadata_answer_auth', err);
    } else {
      fail(res, 500, 'polis_err_delete_participant_metadata_answer', err);
    }
  }
};

/**
 * Handle GET request for metadata questions
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const handleGetMetadataQuestions = async (req, res) => {
  const zid = req.p.zid;
  const zinvite = req.p.zinvite;
  const suzinvite = req.p.suzinvite;

  try {
    // Check if the user has access to the metadata
    await checkMetadataAccess(zid, zinvite, suzinvite);

    // Get the metadata questions
    const questions = await getMetadataQuestions(zid);

    // Add zid to each question for finishArray to process
    for (const q of questions) {
      q.zid = zid;
    }

    finishArray(res, questions);
  } catch (err) {
    if (err.message === 'polis_err_get_participant_metadata_auth') {
      fail(res, 403, 'polis_err_get_participant_metadata_auth', err);
    } else {
      fail(res, 500, 'polis_err_get_participant_metadata_questions', err);
    }
  }
};

/**
 * Handle POST request for metadata questions
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const handlePostMetadataQuestion = async (req, res) => {
  const zid = req.p.zid;
  const key = req.p.key;
  const uid = req.p.uid;

  try {
    // Check if the user is authorized to create a question
    await checkDeleteAuthorization(zid, uid);

    // Create the question
    const question = await createMetadataQuestion(zid, key);

    // The question already has zid from the database
    finishOne(res, question);
  } catch (err) {
    if (err.message === 'polis_err_delete_metadata_auth') {
      fail(res, 403, 'polis_err_post_participant_metadata_auth', err);
    } else {
      fail(res, 500, 'polis_err_post_participant_metadata_key', err);
    }
  }
};

/**
 * Handle POST request for metadata answers
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const handlePostMetadataAnswer = async (req, res) => {
  const zid = req.p.zid;
  const uid = req.p.uid;
  const pmqid = req.p.pmqid;
  const value = req.p.value;

  try {
    // Check if the user is authorized to create an answer
    await checkDeleteAuthorization(zid, uid);

    // Create or update the answer
    const answer = await createOrUpdateMetadataAnswer(pmqid, zid, value);

    // The answer already has zid from the database
    finishOne(res, answer);
  } catch (err) {
    if (err.message === 'polis_err_delete_metadata_auth') {
      fail(res, 403, 'polis_err_post_participant_metadata_auth', err);
    } else {
      fail(res, 500, 'polis_err_post_participant_metadata_value', err);
    }
  }
};

/**
 * Handle GET request for metadata choices
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const handleGetMetadataChoices = async (req, res) => {
  const zid = req.p.zid;

  try {
    // Get the metadata choices
    const choices = await getChoicesForConversation(zid);

    // Add zid to each choice for finishArray to process
    for (const c of choices) {
      c.zid = zid;
    }

    finishArray(res, choices);
  } catch (err) {
    fail(res, 500, 'polis_err_get_participant_metadata_choices', err);
  }
};

/**
 * Handle GET request for metadata answers
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const handleGetMetadataAnswers = async (req, res) => {
  const zid = req.p.zid;
  const zinvite = req.p.zinvite;
  const suzinvite = req.p.suzinvite;
  const pmqid = req.p.pmqid;

  try {
    // Check if the user has access to the metadata
    await checkMetadataAccess(zid, zinvite, suzinvite);

    // Get the metadata answers
    const answers = await getMetadataAnswers(zid, pmqid);

    // Add zid to each answer for finishArray to process
    for (const a of answers) {
      a.zid = zid;
    }

    finishArray(res, answers);
  } catch (err) {
    if (err.message === 'polis_err_get_participant_metadata_auth') {
      fail(res, 403, 'polis_err_get_participant_metadata_auth', err);
    } else {
      fail(res, 500, 'polis_err_get_participant_metadata_answers', err);
    }
  }
};

/**
 * Handle GET request for all metadata
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const handleGetAllMetadata = async (req, res) => {
  const zid = req.p.zid;
  const zinvite = req.p.zinvite;
  const suzinvite = req.p.suzinvite;

  try {
    // Check if the user has access to the metadata
    await checkMetadataAccess(zid, zinvite, suzinvite);

    // Get all metadata
    const metadata = await getAllMetadata(zid);

    // Since this is a custom format, we don't use finishArray or finishOne
    res.status(200).json(metadata);
  } catch (err) {
    if (err.message === 'polis_err_get_participant_metadata_auth') {
      fail(res, 403, 'polis_err_get_participant_metadata_auth', err);
    } else {
      fail(res, 500, 'polis_err_get_participant_metadata', err);
    }
  }
};
