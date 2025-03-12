import { createContributorAgreement } from '../services/contributor/contributorService.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle POST request to create a contributor agreement
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
function handlePostContributors(req, res) {
  const uid = req.p.uid || null;
  const agreement_version = req.p.agreement_version;
  const name = req.p.name;
  const email = req.p.email;
  const github_id = req.p.github_id;
  const company_name = req.p.company_name;

  createContributorAgreement(uid, agreement_version, name, email, github_id, company_name)
    .then(() => {
      res.json({});
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_POST_contributors_misc', err);
    });
}

export { handlePostContributors };
