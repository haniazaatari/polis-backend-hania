import { queryP } from './pg-query.js';

/**
 * Get single-use invite information
 * @param {string} suzinvite - Single-use invite token
 * @returns {Promise<Array>} Invite records
 */
async function getSUZinviteRecord(suzinvite) {
  return await queryP('SELECT * FROM suzinvites WHERE suzinvite = ($1);', [suzinvite]);
}

/**
 * Delete a single-use invite
 * @param {string} suzinvite - Single-use invite token
 * @returns {Promise<void>}
 */
async function deleteSUZinviteRecord(suzinvite) {
  await queryP('DELETE FROM suzinvites WHERE suzinvite = ($1);', [suzinvite]);
}

/**
 * Add inviter record
 * @param {number} inviter_uid - User ID of inviter
 * @param {string} invited_email - Email of invitee
 * @returns {Promise<void>}
 */
async function createInviterRecord(inviter_uid, invited_email) {
  await queryP('INSERT INTO inviters (inviter_uid, invited_email) VALUES ($1, $2);', [inviter_uid, invited_email]);
}

/**
 * Create multiple single-use invites
 * @param {Array<{suzinvite: string, xid: string, zid: number, owner: number}>} invites - Array of invite data
 * @returns {Promise<void>}
 */
async function createSUZinvites(invites) {
  if (!invites.length) return;

  const valuesStatements = invites.map(({ suzinvite, xid, zid, owner }) => {
    // Escape strings to prevent SQL injection
    const escapedSuzinvite = `'${suzinvite.replace(/'/g, "''")}'`;
    const escapedXid = `'${xid.replace(/'/g, "''")}'`;
    return `(${escapedSuzinvite}, ${escapedXid}, ${zid}, ${owner})`;
  });

  const query = `INSERT INTO suzinvites (suzinvite, xid, zid, owner) VALUES ${valuesStatements.join(',')};`;
  await queryP(query, []);
}

export { getSUZinviteRecord, deleteSUZinviteRecord, createInviterRecord, createSUZinvites };
