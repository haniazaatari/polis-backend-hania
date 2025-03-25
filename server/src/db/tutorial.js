import { queryP } from './pg-query.js';

/**
 * Update the tutorial step for a user
 * @param {number} uid - User ID
 * @param {number} step - Tutorial step
 * @returns {Promise<void>}
 */
async function updateTutorialStep(uid, step) {
  await queryP('update users set tut = ($1) where uid = ($2);', [step, uid]);
}

export { updateTutorialStep };
