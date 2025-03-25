import fs from 'fs';
import AWS from 'aws-sdk';
import nodemailer from 'nodemailer';
import mg from 'nodemailer-mailgun-transport';
import Config from '../config.js';
import { getUserInfoForUid2 } from '../services/userService.js';
import logger from '../utils/logger.js';

AWS.config.update({ region: Config.awsRegion });

// Define common email addresses
const polisFromAddress = Config.polisFromAddress;
const adminEmails = Config.adminEmails ? Config.adminEmails.split(',') : [];

function sendTextEmailWithBackup(sender, recipient, subject, text) {
  const transportTypes = Config.emailTransportTypes ? Config.emailTransportTypes.split(',') : ['aws-ses', 'mailgun'];
  if (transportTypes.length < 2) {
    logger.warn('No backup email transport available.');
  }
  const backupTransport = transportTypes[1];
  sendTextEmail(sender, recipient, subject, text, backupTransport);
}

function isDocker() {
  return fs.existsSync('/.dockerenv');
}

function getMailOptions(transportType) {
  let mailgunAuth;
  switch (transportType) {
    case 'maildev':
      return {
        host: isDocker() ? 'maildev' : 'localhost',
        port: 1025,
        ignoreTLS: true
      };
    case 'mailgun':
      mailgunAuth = {
        auth: {
          api_key: Config.mailgunApiKey || 'unset-value',
          domain: Config.mailgunDomain || 'unset-value'
        }
      };
      return mg(mailgunAuth);
    case 'aws-ses':
      return {
        SES: new AWS.SES({ apiVersion: '2010-12-01' })
      };
    default:
      return {};
  }
}

function sendTextEmail(sender, recipient, subject, text, transportTypes = Config.emailTransportTypes, priority = 1) {
  if (!transportTypes) {
    return;
  }
  const transportTypesArray = transportTypes.split(',');
  const thisTransportType = transportTypesArray.shift();
  const nextTransportTypes = [...transportTypesArray];
  const mailOptions = getMailOptions(thisTransportType);
  const transporter = nodemailer.createTransport(mailOptions);
  const promise = transporter.sendMail({ from: sender, to: recipient, subject: subject, text: text }).catch((err) => {
    logger.error(`polis_err_email_sender_failed_transport_priority_${priority.toString()}`, err);
    logger.error(
      `Unable to send email via priority ${priority.toString()} transport '${thisTransportType}' to: ${recipient}`,
      err
    );
    return sendTextEmail(sender, recipient, subject, text, nextTransportTypes.join(','), priority + 1);
  });
  return promise;
}

/**
 * Send an email to a user by their user ID
 * @param {number} uid - The user ID
 * @param {string} subject - The email subject
 * @param {string} body - The email body
 * @returns {Promise<void>}
 */
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

/**
 * Send multiple text emails to a list of recipients
 * @param {string} sender - The sender email address
 * @param {string[]} recipientArray - Array of recipient email addresses
 * @param {string} subject - The email subject
 * @param {string} text - The email body
 * @returns {Promise<any[]>}
 */
function sendMultipleTextEmails(sender, recipientArray, subject, text) {
  const recipients = recipientArray || [];
  return Promise.all(
    recipients.map((email) => {
      const promise = sendTextEmail(sender, email, subject, text);
      promise.catch((err) => {
        logger.error('polis_err_failed_to_email_for_user', { email, err });
      });
      return promise;
    })
  );
}

/**
 * Email the admin team
 * @param {string} subject - The email subject
 * @param {string} body - The email body
 * @returns {Promise<any[]>}
 */
function emailTeam(subject, body) {
  return sendMultipleTextEmails(polisFromAddress, adminEmails, subject, body).catch((err) => {
    logger.error('polis_err_failed_to_email_team', err);
  });
}

/**
 * Email a feature request to the admin team
 * @param {string} message - The feature request message
 * @returns {Promise<any[]>}
 */
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

/**
 * Email the admin team about a serious problem
 * @param {string} message - The problem message
 * @returns {Promise<any[]>}
 */
function emailBadProblemTime(message) {
  const body = `Yo, there was a serious problem. Here's the message:

${message}`;
  return emailTeam('Polis Bad Problems!!!', body);
}

/**
 * Send a test email to verify the backup email system is working
 */
function trySendingBackupEmailTest() {
  if (Config.isDevMode) {
    return;
  }
  const d = new Date();
  if (d.getDay() === 1) {
    sendTextEmailWithBackup(
      polisFromAddress,
      Config.adminEmailEmailTest,
      'monday backup email system test',
      'seems to be working'
    );
  }
}

// Set up the backup email test interval
if (!Config.isDevMode) {
  setInterval(trySendingBackupEmailTest, 1000 * 60 * 60 * 23);
  trySendingBackupEmailTest();
}

export {
  sendTextEmail,
  sendTextEmailWithBackup,
  sendEmailByUid,
  sendMultipleTextEmails,
  emailTeam,
  emailFeatureRequest,
  emailBadProblemTime,
  trySendingBackupEmailTest,
  polisFromAddress,
  adminEmails
};
