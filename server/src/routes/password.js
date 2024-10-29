import Session from '../session';
import logger from '../utils/logger';
import fail from '../utils/fail';
import { queryP as pgQueryP, queryP_readOnly as pgQueryP_readOnly } from '../db/pg-query';
import { generateHashedPassword } from '../auth/password';
import Config from '../config';
import cookies from '../utils/cookies';
import User from '../user';
import emailSenders from '../email/senders';

const sendTextEmail = emailSenders.sendTextEmail;

const getUidForPwResetToken = Session.getUidForPwResetToken;
const clearPwResetToken = Session.clearPwResetToken;
const getServerNameWithProtocol = Config.getServerNameWithProtocol;
const setupPwReset = Session.setupPwReset;
const polisFromAddress = Config.polisFromAddress;
const getUserInfoForUid = User.getUserInfoForUid;

function sendPasswordResetEmail(uid, pwresettoken, serverName, callback) {
  getUserInfoForUid(uid, function (err, userInfo) {
    if (err) {
      return callback?.(err);
    }
    if (!userInfo) {
      return callback?.('missing user info');
    }
    let body = `Hi ${userInfo.hname},

We have just received a password reset request for ${userInfo.email}

To reset your password, visit this page:
${serverName}/pwreset/${pwresettoken}

"Thank you for using Polis`;

    sendTextEmail(polisFromAddress, userInfo.email, 'Polis Password Reset', body)
      .then(function () {
        callback?.();
      })
      .catch(function (err) {
        logger.error('polis_err_failed_to_email_password_reset_code', err);
        callback?.(err);
      });
  });
}

function getUidByEmail(email) {
  email = email.toLowerCase();
  return pgQueryP_readOnly('SELECT uid FROM users where LOWER(email) = ($1);', [email]).then(function (rows) {
    if (!rows || !rows.length) {
      throw new Error('polis_err_no_user_matching_email');
    }
    return rows[0].uid;
  });
}

function handle_POST_auth_password(req, res) {
  let pwresettoken = req.p.pwresettoken;
  let newPassword = req.p.newPassword;

  getUidForPwResetToken(pwresettoken, function (err, userParams) {
    if (err) {
      fail(res, 500, "Password Reset failed. Couldn't find matching pwresettoken.", err);
      return;
    }
    let uid = Number(userParams.uid);
    generateHashedPassword(newPassword, function (err, hashedPassword) {
      return pgQueryP(
        'insert into jianiuevyew (uid, pwhash) values ' +
          '($1, $2) on conflict (uid) ' +
          'do update set pwhash = excluded.pwhash;',
        [uid, hashedPassword]
      ).then(
        () => {
          res.status(200).json('Password reset successful.');
          clearPwResetToken(pwresettoken, function (err) {
            if (err) {
              logger.error('polis_err_auth_pwresettoken_clear_fail', err);
            }
          });
        },
        (err) => {
          fail(res, 500, "Couldn't reset password.", err);
        }
      );
    });
  });
}

function handle_POST_auth_pwresettoken(req, res) {
  let email = req.p.email;

  let server = getServerNameWithProtocol(req);

  cookies.clearCookies(req, res);

  function finish() {
    res.status(200).json('Password reset email sent, please check your email.');
  }

  getUidByEmail(email).then(
    function (uid) {
      setupPwReset(uid, function (err, pwresettoken) {
        sendPasswordResetEmail(uid, pwresettoken, server, function (err) {
          if (err) {
            fail(res, 500, "Error: Couldn't send password reset email.", err);
            return;
          }
          finish();
        });
      });
    },
    function () {
      sendPasswordResetEmailFailure(email, server);
      finish();
    }
  );
}

function sendPasswordResetEmailFailure(email, server) {
  let body = `We were unable to find a pol.is account registered with the email address: ${email}

You may have used another email address to create your account.

If you need to create a new account, you can do that here ${server}/home

Feel free to reply to this email if you need help.`;

  return sendTextEmail(polisFromAddress, email, 'Password Reset Failed', body);
}

export { handle_POST_auth_password, handle_POST_auth_pwresettoken };
