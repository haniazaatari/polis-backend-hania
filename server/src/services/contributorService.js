import { createContributorAgreementRecord } from '../../db/contributors.js';
import { emailTeam } from '../../email/senders.js';
import logger from '../../utils/logger.js';

/**
 * Create a contributor agreement
 * @param {number|null} uid - User ID (optional)
 * @param {number} agreement_version - Agreement version
 * @param {string} name - Contributor name
 * @param {string} email - Contributor email
 * @param {string} github_id - Contributor GitHub ID
 * @param {string} company_name - Contributor company name
 * @returns {Promise<void>} - Resolves when the agreement is created
 */
async function createContributorAgreement(uid, agreement_version, name, email, github_id, company_name) {
  await createContributorAgreementRecord(uid, agreement_version, github_id, name, email, company_name);

  try {
    await emailTeam(
      'contributer agreement signed',
      [uid, agreement_version, github_id, name, email, company_name].join('\n')
    );
  } catch (err) {
    logger.error('Error sending contributor agreement email', err);
  }
}

export { createContributorAgreement };
