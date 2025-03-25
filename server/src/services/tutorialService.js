import { updateTutorialStep as dbUpdateTutorialStep } from '../../db/tutorial.js';

/**
 * Update the tutorial step for a user
 * @param {number} uid - User ID
 * @param {number} step - Tutorial step
 * @returns {Promise<void>} - Resolves when the tutorial step is updated
 */
function updateTutorialStep(uid, step) {
  return dbUpdateTutorialStep(uid, step);
}

export { updateTutorialStep };
