import { updateTutorialStep } from '../services/tutorial/tutorialService.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle POST request to update tutorial step
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
function handlePostTutorial(req, res) {
  const uid = req.p.uid;
  const step = req.p.step;

  updateTutorialStep(uid, step)
    .then(() => {
      res.status(200).json({});
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_saving_tutorial_state', err);
    });
}

export { handlePostTutorial };
