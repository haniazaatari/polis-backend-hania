import { queryP } from '../db/pg-query.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle GET request to verify an email address
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
function handleGetVerification(req, res) {
  const einvite = req.p.e;
  queryP('select * from einvites where einvite = ($1);', [einvite])
    .then((rows) => {
      if (!rows.length) {
        fail(res, 500, 'polis_err_verification_missing');
      }
      const email = rows[0].email;
      return queryP('select email from email_validations where email = ($1);', [email]).then((rows) => {
        if (rows && rows.length > 0) {
          return true;
        }
        return queryP('insert into email_validations (email) values ($1);', [email]);
      });
    })
    .then(() => {
      res.set('Content-Type', 'text/html');
      res.send(`<html><body>
<div style='font-family: Futura, Helvetica, sans-serif;'>
Email verified! You can close this tab or hit the back button.
</div>
</body></html>`);
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_verification', err);
    });
}

export { handleGetVerification };
