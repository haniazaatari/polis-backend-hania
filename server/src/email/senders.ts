// Copyright (C) 2012-present, The Authors. This program is free software: you can redistribute
// it and / or  modify it under the terms of the GNU Affero General Public License, version 3,
// as published by the Free Software Foundation.This program is distributed in the hope that it
// will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
// or FITNESS FOR A PARTICULAR PURPOSE.See the GNU Affero General Public License for more details.
// You should have received a copy of the GNU Affero General Public License along with this program.
// If not, see < http://www.gnu.org/licenses/>.

import AWS from "aws-sdk";
import nodemailer from "nodemailer";
import Config from "../config";
import logger from "../utils/logger";

AWS.config.update({ region: Config.awsRegion });

const sesTransporter = nodemailer.createTransport({
  SES: new AWS.SES({ apiVersion: "2010-12-01" }),
});

function sendTextEmailWithBackup(
  sender: any,
  recipient: any,
  subject: any,
  text: any
) {
  return sendTextEmail(sender, recipient, subject, text);
}

async function sendTextEmail(
  sender: any,
  recipient: any,
  subject: any,
  text: any
) {
  try {
    return await sesTransporter.sendMail({
      from: sender,
      to: recipient,
      subject: subject,
      text: text,
    });
  } catch (err) {
    logger.error(`Failed to send SES email to: ${recipient}`, err);
    throw err;
  }
}

function sendMultipleTextEmails(
  sender: string | undefined,
  recipientArray: any[],
  subject: string,
  text: string
) {
  recipientArray = recipientArray || [];
  return Promise.all(
    recipientArray.map(function (email: string) {
      const promise = sendTextEmail(sender, email, subject, text);
      promise.catch(function (err: any) {
        logger.error("polis_err_failed_to_email_for_user", { email, err });
      });
      return promise;
    })
  );
}

function emailTeam(subject: string, body: string) {
  const adminEmails = Config.adminEmails ? JSON.parse(Config.adminEmails) : [];

  return sendMultipleTextEmails(
    Config.polisFromAddress,
    adminEmails,
    subject,
    body
  ).catch(function (err: any) {
    logger.error("polis_err_failed_to_email_team", err);
  });
}

export {
  sendMultipleTextEmails,
  sendTextEmail,
  sendTextEmailWithBackup,
  emailTeam,
};
