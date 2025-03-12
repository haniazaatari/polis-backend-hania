import * as pg from '../db/pg-query.js';
import { sendEinviteEmail } from '../email/specialized.js';
import { generateRandomToken } from '../services/auth/tokenService.js';
import { fail } from '../utils/responseHandlers.js';

const pgQueryP = pg.queryP;

/**
 * Send an email invite
 * @param {Object} req - Express request object
 * @param {string} email - The recipient's email
 * @returns {Promise<void>}
 */
function doSendEinvite(email) {
  return generateRandomToken(30, false).then((einvite) =>
    pgQueryP('insert into einvites (email, einvite) values ($1, $2);', [email, einvite]).then((_rows) =>
      sendEinviteEmail(email, einvite)
    )
  );
}

/**
 * Handle POST request to send an email invite
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
function handlePostEinvites(req, res) {
  const email = req.p.email;
  doSendEinvite(email)
    .then(() => {
      res.status(200).json({});
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_sending_einvite', err);
    });
}

/**
 * Handle GET request to retrieve an email invite
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
function handleGetEinvites(req, res) {
  const einvite = req.p.einvite;
  pgQueryP('select * from einvites where einvite = ($1);', [einvite])
    .then((rows) => {
      if (!rows.length) {
        throw new Error('polis_err_missing_einvite');
      }
      res.status(200).json(rows[0]);
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_fetching_einvite', err);
    });
}

export { doSendEinvite, handlePostEinvites, handleGetEinvites };
