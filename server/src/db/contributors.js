import { pgQueryP } from './pg-query.js';

/**
 * Create a contributor agreement record in the database
 * @param {number|null} uid - User ID (optional)
 * @param {number} agreement_version - Agreement version
 * @param {string} name - Contributor name
 * @param {string} email - Contributor email
 * @param {string} github_id - Contributor GitHub ID
 * @param {string} company_name - Contributor company name
 * @returns {Promise<void>}
 */
async function createContributorAgreementRecord(uid, agreement_version, name, email, github_id, company_name) {
  await pgQueryP(
    'insert into contributor_agreement_signatures (uid, agreement_version, github_id, name, email, company_name) ' +
      'values ($1, $2, $3, $4, $5, $6);',
    [uid, agreement_version, github_id, name, email, company_name]
  );
}

export { createContributorAgreementRecord };
