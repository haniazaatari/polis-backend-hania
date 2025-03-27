import { encode } from 'html-entities';
import _ from 'underscore';
import Config from '../config.js';
import Conversation from '../conversation.js';
import dbPgQuery, { query as pgQuery, queryP as pgQueryP, query_readOnly as pgQuery_readOnly } from '../db/pg-query.js';
import emailSenders from '../email/senders.js';
import Password from '../routes/password.js';
import { HMAC_SIGNATURE_PARAM_NAME } from '../server.js';
import User from '../user.js';
import Utils from '../utils/common.js';
import fail from '../utils/fail.js';
import logger from '../utils/logger.js';
import { getZinvite } from '../utils/zinvite.js';

const polisFromAddress = Config.polisFromAddress;
const adminEmails = Config.adminEmails ? JSON.parse(Config.adminEmails) : [];
const devMode = Config.devMode;
const serverUrl = Config.getServerUrl();
const sendTextEmail = emailSenders.sendTextEmail;
const sendTextEmailWithBackupOnly = emailSenders.sendTextEmailWithBackupOnly;
const getUserInfoForUid = User.getUserInfoForUid;
const getUserInfoForUid2 = User.getUserInfoForUid2;
const generateTokenP = Password.generateTokenP;
const getConversationInfo = Conversation.getConversationInfo;
const escapeLiteral = Utils.escapeLiteral;
const generateToken = Password.generateToken;

function _sendPasswordResetEmailFailure(email, server) {
  const body = `We were unable to find a pol.is account registered with the email address: ${email}

You may have used another email address to create your account.

If you need to create a new account, you can do that here ${server}/home

Feel free to reply to this email if you need help.`;
  return sendTextEmail(polisFromAddress, email, 'Password Reset Failed', body);
}

function emailFeatureRequest(message) {
  const body = `Somebody clicked a dummy button!

${message}`;
  return sendMultipleTextEmails(polisFromAddress, adminEmails, 'Dummy button clicked!!!', body).catch((err) => {
    logger.error('polis_err_failed_to_email_for_dummy_button', {
      message,
      err
    });
  });
}

function emailTeam(subject, body) {
  return sendMultipleTextEmails(polisFromAddress, adminEmails, subject, body).catch((err) => {
    logger.error('polis_err_failed_to_email_team', err);
  });
}

function emailBadProblemTime(message) {
  const body = `Yo, there was a serious problem. Here's the message:

${message}`;
  return emailTeam('Polis Bad Problems!!!', body);
}

function _sendPasswordResetEmail(uid, pwresettoken, serverName, callback) {
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

function sendMultipleTextEmails(sender, recipientArray, subject, text) {
  recipientArray = recipientArray || [];
  return Promise.all(
    recipientArray.map((email) => {
      const promise = sendTextEmail(sender, email, subject, text);
      promise.catch((err) => {
        logger.error('polis_err_failed_to_email_for_user', { email, err });
      });
      return promise;
    })
  );
}

function trySendingBackupEmailTest() {
  if (devMode) {
    return;
  }
  const d = new Date();
  if (d.getDay() === 1) {
    sendTextEmailWithBackupOnly(
      polisFromAddress,
      Config.adminEmailEmailTest,
      'monday backup email system test',
      'seems to be working'
    );
  }
}

setInterval(trySendingBackupEmailTest, 1000 * 60 * 60 * 23);

trySendingBackupEmailTest();

function sendEinviteEmail(_req, email, einvite) {
  const body = `Welcome to pol.is!

Click this link to open your account:

${serverUrl}/welcome/${einvite}

Thank you for using Polis`;
  return sendTextEmail(polisFromAddress, email, 'Get Started with Polis', body);
}

function _isEmailVerified(email) {
  return dbPgQuery
    .queryP('select * from email_validations where email = ($1);', [email])
    .then((rows) => rows.length > 0);
}

function handle_GET_verification(req, res) {
  const einvite = req.p.e;
  pgQueryP('select * from einvites where einvite = ($1);', [einvite])
    .then((rows) => {
      if (!rows.length) {
        fail(res, 500, 'polis_err_verification_missing');
      }
      const email = rows[0].email;
      return pgQueryP('select email from email_validations where email = ($1);', [email]).then((rows) => {
        if (rows && rows.length > 0) {
          return true;
        }
        return pgQueryP('insert into email_validations (email) values ($1);', [email]);
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

function handle_GET_notifications_subscribe(req, res) {
  const zid = req.p.zid;
  const email = req.p.email;
  const params = {
    conversation_id: req.p.conversation_id,
    email: req.p.email
  };
  params[HMAC_SIGNATURE_PARAM_NAME] = req.p[HMAC_SIGNATURE_PARAM_NAME];
  verifyHmacForQueryParams('api/v3/notifications/subscribe', params)
    .then(
      () =>
        pgQueryP(
          'update participants set subscribed = 1 where uid = (select uid from users where email = ($2)) and zid = ($1);',
          [zid, email]
        ).then(() => {
          res.set('Content-Type', 'text/html');
          res.send(`<h1>Subscribed!</h1>
<p>
<a href="${createNotificationsUnsubscribeUrl(req.p.conversation_id, req.p.email)}">oops, unsubscribe me.</a>
</p>`);
        }),
      () => {
        fail(res, 403, 'polis_err_subscribe_signature_mismatch');
      }
    )
    .catch((err) => {
      fail(res, 500, 'polis_err_subscribe_misc', err);
    });
}

function handle_GET_notifications_unsubscribe(req, res) {
  const zid = req.p.zid;
  const email = req.p.email;
  const params = {
    conversation_id: req.p.conversation_id,
    email: email
  };
  params[HMAC_SIGNATURE_PARAM_NAME] = req.p[HMAC_SIGNATURE_PARAM_NAME];
  verifyHmacForQueryParams('api/v3/notifications/unsubscribe', params)
    .then(
      () =>
        pgQueryP(
          'update participants set subscribed = 0 where uid = (select uid from users where email = ($2)) and zid = ($1);',
          [zid, email]
        ).then(() => {
          res.set('Content-Type', 'text/html');
          res.send(`<h1>Unsubscribed.</h1>
<p>
<a href="${createNotificationsSubscribeUrl(req.p.conversation_id, req.p.email)}">oops, subscribe me again.</a>
</p>`);
        }),
      () => {
        fail(res, 403, 'polis_err_unsubscribe_signature_mismatch');
      }
    )
    .catch((err) => {
      fail(res, 500, 'polis_err_unsubscribe_misc', err);
    });
}

function handle_POST_sendEmailExportReady(req, res) {
  if (req.p.webserver_pass !== Config.webserverPass || req.p.webserver_username !== Config.webserverUsername) {
    return fail(res, 403, 'polis_err_sending_export_link_to_email_auth');
  }
  const email = req.p.email;
  const subject = `Polis data export for conversation pol.is/${req.p.conversation_id}`;
  const fromAddress = `Polis Team <${Config.adminEmailDataExport}>`;
  const body = `Greetings

You created a data export for conversation ${serverUrl}/${req.p.conversation_id} that has just completed. You can download the results for this conversation at the following url:

${serverUrl}/api/v3/dataExport/results?filename=${req.p.filename}&conversation_id=${req.p.conversation_id}

Please let us know if you have any questions about the data.

Thanks for using Polis!
`;
  sendTextEmail(fromAddress, email, subject, body)
    .then(() => {
      res.status(200).json({});
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_sending_export_link_to_email', err);
    });
}

function sendNotificationEmail(uid, url, conversation_id, email, _remaining) {
  const subject = `New statements to vote on (conversation ${conversation_id})`;
  let body = 'There are new statements available for you to vote on here:\n';
  body += '\n';
  body += `${url}\n`;
  body += '\n';
  body +=
    "You're receiving this message because you're signed up to receive Polis notifications for this conversation. You can unsubscribe from these emails by clicking this link:\n";
  body += `${createNotificationsUnsubscribeUrl(conversation_id, email)}\n`;
  body += '\n';
  body +=
    "If for some reason the above link does not work, please reply directly to this email with the message 'Unsubscribe' and we will remove you within 24 hours.";
  body += '\n';
  body += 'Thanks for your participation';
  return sendEmailByUid(uid, subject, body);
}

function createNotificationsSubscribeUrl(conversation_id, email) {
  const params = {
    conversation_id: conversation_id,
    email: encode(email)
  };
  const path = 'api/v3/notifications/subscribe';
  params[HMAC_SIGNATURE_PARAM_NAME] = createHmacForQueryParams(path, params);
  return `${serverUrl}/${path}?${paramsToStringSortedByName(params)}`;
}

function createNotificationsUnsubscribeUrl(conversation_id, email) {
  const params = {
    conversation_id: conversation_id,
    email: encode(email)
  };
  const path = 'api/v3/notifications/unsubscribe';
  params[HMAC_SIGNATURE_PARAM_NAME] = createHmacForQueryParams(path, params);
  return `${serverUrl}/${path}?${paramsToStringSortedByName(params)}`;
}

function sendEmailByUid(uid, subject, body) {
  return getUserInfoForUid2(uid).then((userInfo) =>
    sendTextEmail(
      polisFromAddress,
      userInfo.hname ? `${userInfo.hname} <${userInfo.email}>` : userInfo.email,
      subject,
      body
    )
  );
}

function createHmacForQueryParams(path, params) {
  path = path.replace(/\/$/, '');
  const s = `${path}?${paramsToStringSortedByName(params)}`;
  const hmac = crypto.createHmac('sha1', 'G7f387ylIll8yuskuf2373rNBmcxqWYFfHhdsd78f3uekfs77EOLR8wofw');
  hmac.setEncoding('hex');
  hmac.write(s);
  hmac.end();
  const hash = hmac.read();
  return hash;
}

const verifyHmacForQueryParams = (path, params) => {
  return new Promise((resolve, reject) => {
    const clonedParams = { ...params };
    const hash = clonedParams[HMAC_SIGNATURE_PARAM_NAME];
    delete clonedParams[HMAC_SIGNATURE_PARAM_NAME];
    const correctHash = createHmacForQueryParams(path, clonedParams);
    setTimeout(() => {
      logger.debug('comparing', { correctHash, hash });
      if (correctHash === hash) {
        resolve();
      } else {
        reject();
      }
    });
  });
};

function paramsToStringSortedByName(params) {
  const pairs = _.pairs(params).sort((a, b) => a[0] > b[0]);
  const pairsList = pairs.map((pair) => pair.join('='));
  return pairsList.join('&');
}

function handle_POST_sendCreatedLinkToEmail(req, res) {
  pgQuery_readOnly('SELECT * FROM users WHERE uid = $1', [req.p.uid], (err, results) => {
    if (err) {
      fail(res, 500, 'polis_err_get_email_db', err);
      return;
    }
    const email = results.rows[0].email;
    const fullname = results.rows[0].hname;
    pgQuery_readOnly('select * from zinvites where zid = $1', [req.p.zid], (_err, results) => {
      const zinvite = results.rows[0].zinvite;
      const createdLink = `${serverUrl}/#${req.p.zid}/${zinvite}`;
      const body = `Hi ${fullname},\n\nHere's a link to the conversation you just created. Use it to invite participants to the conversation. Share it by whatever network you prefer - Gmail, Facebook, Twitter, etc., or just post it to your website or blog. Try it now! Click this link to go to your conversation: \n\n${createdLink}\n\nWith gratitude,\n\nThe team at pol.is`;
      return sendTextEmail(polisFromAddress, email, `Link: ${createdLink}`, body)
        .then(() => {
          res.status(200).json({});
        })
        .catch((err) => {
          fail(res, 500, 'polis_err_sending_created_link_to_email', err);
        });
    });
  });
}

function doSendEinvite(req, email) {
  return generateTokenP(30, false).then((einvite) =>
    pgQueryP('insert into einvites (email, einvite) values ($1, $2);', [email, einvite]).then((_rows) =>
      sendEinviteEmail(req, email, einvite)
    )
  );
}

function sendSuzinviteEmail(_req, email, conversation_id, suzinvite) {
  const body = `Welcome to pol.is!\n\nClick this link to open your account:\n\n${serverUrl}/ot/${conversation_id}/${suzinvite}\n\nThank you for using Polis\n`;
  return sendTextEmail(polisFromAddress, email, 'Join the pol.is conversation!', body);
}

function handle_POST_users_invite(req, res) {
  const uid = req.p.uid;
  const emails = req.p.emails;
  const zid = req.p.zid;
  const conversation_id = req.p.conversation_id;
  getConversationInfo(zid)
    .then((conv) => {
      const owner = conv.owner;
      generateSUZinvites(emails.length)
        .then((suzinviteArray) => {
          const pairs = _.zip(emails, suzinviteArray);
          const valuesStatements = pairs.map((pair) => {
            const xid = escapeLiteral(pair[0]);
            const suzinvite = escapeLiteral(pair[1]);
            const statement = `(${suzinvite}, ${xid},${zid},${owner})`;
            return statement;
          });
          const query = `INSERT INTO suzinvites (suzinvite, xid, zid, owner) VALUES ${valuesStatements.join(',')};`;
          pgQuery(query, [], (err, _results) => {
            if (err) {
              fail(res, 500, 'polis_err_saving_invites', err);
              return;
            }
            Promise.all(
              pairs.map((pair) => {
                const email = pair[0];
                const suzinvite = pair[1];
                return sendSuzinviteEmail(req, email, conversation_id, suzinvite).then(
                  () => addInviter(uid, email),
                  (err) => {
                    fail(res, 500, 'polis_err_sending_invite', err);
                  }
                );
              })
            )
              .then(() => {
                res.status(200).json({
                  status: ':-)'
                });
              })
              .catch((err) => {
                fail(res, 500, 'polis_err_sending_invite', err);
              });
          });
        })
        .catch((err) => {
          fail(res, 500, 'polis_err_generating_invites', err);
        });
    })
    .catch((err) => {
      fail(res, 500, 'polis_err_getting_conversation_info', err);
    });
}

function generateSUZinvites(numTokens) {
  return new Promise((resolve, reject) => {
    generateToken(31 * numTokens, true, (err, longStringOfTokens) => {
      if (err) {
        reject(new Error('polis_err_creating_otzinvite'));
        return;
      }
      const otzinviteArrayRegexMatch = longStringOfTokens?.match(/.{1,31}/g);
      let otzinviteArray = otzinviteArrayRegexMatch?.slice(0, numTokens);
      otzinviteArray = otzinviteArray?.map((suzinvite) => generateConversationURLPrefix() + suzinvite);
      resolve(otzinviteArray);
    });
  });
}

function addInviter(inviter_uid, invited_email) {
  return pgQueryP('insert into inviters (inviter_uid, invited_email) VALUES ($1, $2);', [inviter_uid, invited_email]);
}

function generateConversationURLPrefix() {
  return `${_.random(2, 9)}`;
}

function createOneSuzinvite(xid, zid, owner, generateSingleUseUrl) {
  return generateSUZinvites(1).then((suzinviteArray) => {
    const suzinvite = suzinviteArray[0];
    return pgQueryP('INSERT INTO suzinvites (suzinvite, xid, zid, owner) VALUES ($1, $2, $3, $4);', [
      suzinvite,
      xid,
      zid,
      owner
    ])
      .then((_result) => getZinvite(zid))
      .then((conversation_id) => ({
        zid: zid,
        conversation_id: conversation_id
      }))
      .then((o) => ({
        zid: o.zid,
        conversation_id: o.conversation_id,
        suurl: generateSingleUseUrl(o.conversation_id, suzinvite)
      }));
  });
}

function sendImplicitConversationCreatedEmails(site_id, page_id, url, modUrl, seedUrl) {
  const body = `Conversation created!\n\nYou can find the conversation here:\n${url}\nYou can moderate the conversation here:\n${modUrl}\n\nWe recommend you add 2-3 short statements to start things off. These statements should be easy to agree or disagree with. Here are some examples:\n "I think the proposal is good"\n "This topic matters a lot"\n or "The bike shed should have a metal roof"\n\nYou can add statements here:\n${seedUrl}\n\nFeel free to reply to this email if you have questions.\n\nAdditional info: \nsite_id: "${site_id}"\npage_id: "${page_id}"\n\n`;
  return pgQueryP('select email from users where site_id = ($1)', [site_id]).then((rows) => {
    const emails = _.pluck(rows, 'email');
    return sendMultipleTextEmails(polisFromAddress, emails, 'Polis conversation created', body);
  });
}

export default {
  createOneSuzinvite,
  doSendEinvite,
  emailBadProblemTime,
  emailFeatureRequest,
  emailTeam,
  handle_GET_notifications_subscribe,
  handle_GET_notifications_unsubscribe,
  handle_GET_verification,
  handle_POST_sendCreatedLinkToEmail,
  handle_POST_sendEmailExportReady,
  handle_POST_users_invite,
  sendEmailByUid,
  sendImplicitConversationCreatedEmails,
  sendMultipleTextEmails,
  sendNotificationEmail,
  sendTextEmail
};
