import { queryP } from '../../db/pg-query.js';

/**
 * Update the tutorial step for a user
 * @param {number} uid - User ID
 * @param {number} step - Tutorial step
 * @returns {Promise<void>} - Resolves when the tutorial step is updated
 */
function updateTutorialStep(uid, step) {
  return queryP('update users set tut = ($1) where uid = ($2);', [step, uid]);
}

export { updateTutorialStep };
