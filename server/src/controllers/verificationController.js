import { verifyEmail } from '../services/einvite/einviteService.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle GET request to verify an email address
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleVerification(req, res) {
  try {
    await verifyEmail(req.p.einvite);
    res.set('Content-Type', 'text/html');
    res.send(`<html><body>
<div style='font-family: Futura, Helvetica, sans-serif;'>
Email verified! You can close this tab or hit the back button.
</div>
</body></html>`);
  } catch (err) {
    fail(res, 500, 'polis_err_verifying_email', err);
  }
}

export { handleVerification };
