// Since you cannot cleanly export anything from server.ts, we're moving these functions to a separate file,
// to assist with extracting server concerns into seperate modules.

import _ from "underscore";
import { generateToken } from "./auth/password";
import { getUserInfoForUid2 } from "./user";
import { getZinvite } from "./utils/zinvite";
import { query_readOnly as pgQuery_readOnly, query as pgQuery, queryP as pgQueryP } from "./db/pg-query";
import { sendTextEmail } from "./email/senders";
import Config from "./config";
import fail from "./utils/fail";

const { getServerNameWithProtocol, polisFromAddress } = Config;

function ifDefinedSet(
  name: string,
  source: { [x: string]: any },
  dest: { [x: string]: any }
) {
  if (!_.isUndefined(source[name])) {
    dest[name] = source[name];
  }
}

function verifyMetadataAnswersExistForEachQuestion(zid: any) {
  const errorcode = "polis_err_missing_metadata_answers";
  return new Promise<void>((resolve, reject) => {
    pgQuery_readOnly(
      "select pmqid from participant_metadata_questions where zid = ($1);",
      [zid],
      function (err: any, results: { rows: any[] }) {
        if (err) {
          reject(err);
          return;
        }
        if (!results.rows || !results.rows.length) {
          resolve();
          return;
        }
        const pmqids = results.rows.map(function (row: { pmqid: any }) {
          return Number(row.pmqid);
        });
        pgQuery_readOnly(
          "select pmaid, pmqid from participant_metadata_answers where pmqid in (" +
          pmqids.join(",") +
          ") and alive = TRUE and zid = ($1);",
          [zid],
          function (err: any, results: { rows: any[] }) {
            if (err) {
              reject(err);
              return;
            }
            if (!results.rows || !results.rows.length) {
              reject(new Error(errorcode));
              return;
            }
            const questions = _.reduce(
              pmqids,
              function (o: { [x: string]: number }, pmqid: string | number) {
                o[pmqid] = 1;
                return o;
              },
              {}
            );
            results.rows.forEach(function (row: { pmqid: string | number }) {
              delete questions[row.pmqid];
            });
            if (Object.keys(questions).length) {
              reject(new Error(errorcode));
            } else {
              resolve();
            }
          }
        );
      }
    );
  });
}

// kind of crappy that we're replacing the zinvite.
// This is needed because we initially create a conversation with the POST, then actually set the properties with the subsequent PUT.
// if we stop doing that, we can remove this function.
function generateAndReplaceZinvite(zid: any, generateShortZinvite: any) {
  let len = 12;
  if (generateShortZinvite) {
    len = 6;
  }
  return new Promise(function (
    resolve: (arg0: any) => void,
    reject: (arg0: string) => void
  ) {
    generateToken(len, false, function (err: any, zinvite: any) {
      if (err) {
        return reject("polis_err_creating_zinvite");
      }
      pgQuery(
        "update zinvites set zinvite = ($1) where zid = ($2);",
        [zinvite, zid],
        function (err: any, results: any) {
          if (err) {
            reject(err);
          } else {
            resolve(zinvite);
          }
        }
      );
    });
  });
}

function buildConversationUrl(req: any, zinvite: string | null) {
  return getServerNameWithProtocol(req) + "/" + zinvite;
}

function getConversationUrl(req: any, zid: any, dontUseCache: boolean) {
  return getZinvite(zid, dontUseCache).then(function (zinvite: any) {
    return buildConversationUrl(req, zinvite);
  });
}

function sendEmailByUid(uid?: any, subject?: string, body?: string | number) {
  return getUserInfoForUid2(uid).then(function (userInfo: {
    hname: any;
    email: any;
  }) {
    return sendTextEmail(
      polisFromAddress,
      userInfo.hname
        ? `${userInfo.hname} <${userInfo.email}>`
        : userInfo.email,
      subject,
      body
    );
  });
}

function finishOne(
  res: {
    status: (
      arg0: any
    ) => { (): any; new(): any; json: { (arg0: any): void; new(): any } };
  },
  o: { url?: string; zid?: any; currentPid?: any },
  dontUseCache?: boolean | undefined,
  altStatusCode?: number | undefined
) {
  addConversationId(o, dontUseCache)
    .then(
      function (item: { zid: any }) {
        // ensure we don't expose zid
        if (item.zid) {
          delete item.zid;
        }
        const statusCode = altStatusCode || 200;
        res.status(statusCode).json(item);
      },
      function (err: any) {
        fail(res, 500, "polis_err_finishing_responseA", err);
      }
    )
    .catch(function (err: any) {
      fail(res, 500, "polis_err_finishing_response", err);
    });
}

function updateConversationModifiedTime(zid: any, t?: undefined) {
  const modified = _.isUndefined(t) ? Date.now() : Number(t);
  let query =
    "update conversations set modified = ($2) where zid = ($1) and modified < ($2);";
  let params = [zid, modified];
  if (_.isUndefined(t)) {
    query =
      "update conversations set modified = now_as_millis() where zid = ($1);";
    params = [zid];
  }
  return pgQueryP(query, params);
}

function addConversationId(
  o: { zid?: any; conversation_id?: any },
  dontUseCache: any
) {
  if (!o.zid) {
    // if no zid, resolve without fetching zinvite.
    return Promise.resolve(o);
  }
  return getZinvite(o.zid, dontUseCache).then(function (
    conversation_id: any
  ) {
    o.conversation_id = conversation_id;
    return o;
  });
}

export {
  buildConversationUrl,
  finishOne,
  generateAndReplaceZinvite,
  getConversationUrl,
  ifDefinedSet,
  sendEmailByUid,
  updateConversationModifiedTime,
  verifyMetadataAnswersExistForEachQuestion,
};
