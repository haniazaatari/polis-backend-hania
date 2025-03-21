import { generateHashedPassword } from '../auth/password.js';
import Config from '../config.js';
import { queryP as pgQueryP, queryP_readOnly as pgQueryP_readOnly } from '../db/pg-query.js';
import emailSenders from '../email/senders.js';
import Session from '../session.js';
import User from '../user.js';
import cookies from '../utils/cookies.js';
import fail from '../utils/fail.js';
import logger from '../utils/logger.js';
const sendTextEmail = emailSenders.sendTextEmail;
const getUidForPwResetToken = Session.getUidForPwResetToken;
const clearPwResetToken = Session.clearPwResetToken;
const getServerNameWithProtocol = Config.getServerNameWithProtocol;
const setupPwReset = Session.setupPwReset;
const polisFromAddress = Config.polisFromAddress;
const getUserInfoForUid = User.getUserInfoForUid;
function sendPasswordResetEmail(uid, pwresettoken, serverName, callback) {
  getUserInfoForUid(uid, (err, userInfo) => {
    if (err) {
      return callback?.(err);
    }
    if (!userInfo) {
      return callback?.('missing user info');
    }
    const body = `Hi ${userInfo.hname},

We have just received a password reset request for ${userInfo.email}

To reset your password, visit this page:
${serverName}/pwreset/${pwresettoken}

"Thank you for using Polis`;
    sendTextEmail(polisFromAddress, userInfo.email, 'Polis Password Reset', body)
      .then(() => {
        callback?.();
      })
      .catch((err) => {
        logger.error('polis_err_failed_to_email_password_reset_code', err);
        callback?.(err);
      });
  });
}
function getUidByEmail(email) {
  email = email.toLowerCase();
  return pgQueryP_readOnly('SELECT uid FROM users where LOWER(email) = ($1);', [email]).then((rows) => {
    if (!rows || !rows.length) {
      throw new Error('polis_err_no_user_matching_email');
    }
    return rows[0].uid;
  });
}
function handle_POST_auth_password(req, res) {
  const pwresettoken = req.p.pwresettoken;
  const newPassword = req.p.newPassword;
  getUidForPwResetToken(pwresettoken, (err, userParams) => {
    if (err) {
      fail(res, 500, "Password Reset failed. Couldn't find matching pwresettoken.", err);
      return;
    }
    const uid = Number(userParams.uid);
    generateHashedPassword(newPassword, (_err, hashedPassword) =>
      pgQueryP(
        'insert into jianiuevyew (uid, pwhash) values ' +
          '($1, $2) on conflict (uid) ' +
          'do update set pwhash = excluded.pwhash;',
        [uid, hashedPassword]
      ).then(
        (_rows) => {
          res.status(200).json('Password reset successful.');
          clearPwResetToken(pwresettoken, (err) => {
            if (err) {
              logger.error('polis_err_auth_pwresettoken_clear_fail', err);
            }
          });
        },
        (err) => {
          fail(res, 500, "Couldn't reset password.", err);
        }
      )
    );
  });
}
function handle_POST_auth_pwresettoken(req, res) {
  const email = req.p.email;
  const server = getServerNameWithProtocol(req);
  cookies.clearCookies(req, res);
  function finish() {
    res.status(200).json('Password reset email sent, please check your email.');
  }
  getUidByEmail(email).then(
    (uid) => {
      setupPwReset(uid, (_err, pwresettoken) => {
        sendPasswordResetEmail(uid, pwresettoken, server, (err) => {
          if (err) {
            fail(res, 500, "Error: Couldn't send password reset email.", err);
            return;
          }
          finish();
        });
      });
    },
    () => {
      sendPasswordResetEmailFailure(email, server);
      finish();
    }
  );
}
function sendPasswordResetEmailFailure(email, server) {
  const body = `We were unable to find a pol.is account registered with the email address: ${email}

You may have used another email address to create your account.

If you need to create a new account, you can do that here ${server}/home

Feel free to reply to this email if you need help.`;
  return sendTextEmail(polisFromAddress, email, 'Password Reset Failed', body);
}
export { handle_POST_auth_password, handle_POST_auth_pwresettoken };
