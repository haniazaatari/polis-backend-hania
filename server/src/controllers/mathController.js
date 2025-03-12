import {
  addXidsToWhitelist,
  getBidForParticipant,
  getBidToPidMapping,
  getCorrelationMatrixForReport,
  getXidsForConversation,
  processPcaData,
  updateMath
} from '../services/math/mathService.js';
import { fail } from '../utils/responseHandlers.js';

/**
 * Handle GET /math/pca
 * Legacy endpoint - returns 304
 */
export function handleGetMathPca(_req, res) {
  res.status(304).end();
}

/**
 * Handle GET /math/pca2
 * Get PCA data for a conversation
 */
export async function handleGetMathPca2(req, res) {
  try {
    const zid = req.p.zid;
    let math_tick = req.p.math_tick;
    const ifNoneMatch = req.p.ifNoneMatch;

    if (ifNoneMatch) {
      if (math_tick !== undefined) {
        return fail(res, 400, 'Expected either math_tick param or If-Not-Match header, but not both.');
      }
      if (ifNoneMatch.includes('*')) {
        math_tick = 0;
      } else {
        const entries = ifNoneMatch.split(/ *, */).map((x) => {
          return Number(
            x
              .replace(/^[wW]\//, '')
              .replace(/^"/, '')
              .replace(/"$/, '')
          );
        });
        math_tick = Math.min(...entries);
      }
    } else if (math_tick === undefined) {
      math_tick = -1;
    }

    const data = await processPcaData(zid, math_tick);

    if (data) {
      res.set({
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        Etag: `"${data.asPOJO.math_tick}"`
      });
      res.send(data.asBufferOfGzippedJson);
    } else {
      res.status(304).end();
    }
  } catch (err) {
    fail(res, 500, err);
  }
}

/**
 * Handle POST /mathUpdate
 * Update math for a conversation
 */
export async function handlePostMathUpdate(req, res) {
  try {
    const zid = req.p.zid;
    const uid = req.p.uid;
    const math_update_type = req.p.math_update_type;

    if (!math_update_type || math_update_type.length < 1 || math_update_type.length > 32) {
      return fail(res, 400, 'Invalid math_update_type parameter');
    }

    await updateMath(zid, uid, math_update_type);
    res.status(200).json({});
  } catch (err) {
    fail(res, 500, 'polis_err_POST_math_update', err);
  }
}

/**
 * Handle GET /math/correlationMatrix
 * Get correlation matrix for a report
 */
export async function handleGetMathCorrelationMatrix(req, res) {
  try {
    const rid = req.p.rid;
    const math_tick = req.p.math_tick !== undefined ? req.p.math_tick : -1;

    const result = await getCorrelationMatrixForReport(rid, math_tick);

    if (result.status === 'pending') {
      res.status(202).json({ status: 'pending' });
    } else if (result.status === 'polis_report_needs_comment_selection') {
      res.status(202).json({ status: 'polis_report_needs_comment_selection' });
    } else {
      res.json(result);
    }
  } catch (err) {
    fail(res, 500, 'polis_err_GET_math_correlationMatrix', err);
  }
}

/**
 * Handle GET /bidToPid
 * Get bid to pid mapping for a conversation
 */
export async function handleGetBidToPid(req, res) {
  try {
    const zid = req.p.zid;
    const math_tick = req.p.math_tick !== undefined ? req.p.math_tick : 0;

    const result = await getBidToPidMapping(zid, math_tick);

    if (result) {
      res.json({ bidToPid: result.bidToPid });
    } else {
      res.status(304).end();
    }
  } catch (_err) {
    res.status(304).end();
  }
}

/**
 * Handle GET /xids
 * Get XIDs for a conversation
 */
export async function handleGetXids(req, res) {
  try {
    const uid = req.p.uid;
    const zid = req.p.zid;

    const xids = await getXidsForConversation(zid, uid);
    res.status(200).json(xids);
  } catch (err) {
    if (err.message === 'polis_err_get_xids_not_authorized') {
      fail(res, 403, 'polis_err_get_xids_not_authorized');
    } else {
      fail(res, 500, 'polis_err_get_xids', err);
    }
  }
}

/**
 * Handle POST /xidWhitelist
 * Add XIDs to whitelist
 */
export async function handlePostXidWhitelist(req, res) {
  try {
    const xid_whitelist = req.p.xid_whitelist;
    const owner = req.p.uid;

    if (!xid_whitelist || !Array.isArray(xid_whitelist) || !xid_whitelist.length) {
      return fail(res, 400, 'polis_err_missing_xid_whitelist');
    }

    if (xid_whitelist.length > 9999) {
      return fail(res, 400, 'polis_err_xid_whitelist_too_long');
    }

    for (const xid of xid_whitelist) {
      if (typeof xid !== 'string' || !xid.length || xid.length > 999) {
        return fail(res, 400, 'polis_err_invalid_xid');
      }
    }

    await addXidsToWhitelist(xid_whitelist, owner);
    res.status(200).json({});
  } catch (err) {
    if (err.message?.includes('bad_xid')) {
      fail(res, 400, 'polis_err_bad_xid', err);
    } else {
      fail(res, 500, 'polis_err_POST_xidWhitelist', err);
    }
  }
}

/**
 * Handle GET /bid
 * Get bid for a participant
 */
export async function handleGetBid(req, res) {
  try {
    const uid = req.p.uid;
    const zid = req.p.zid;
    const math_tick = req.p.math_tick !== undefined ? req.p.math_tick : 0;

    const result = await getBidForParticipant(zid, uid, math_tick);
    res.json(result);
  } catch (err) {
    if (err.message === 'polis_err_get_bid_bad_pid') {
      fail(res, 500, 'polis_err_get_bid_bad_pid');
    } else {
      fail(res, 500, 'polis_err_get_bid_misc', err);
    }
  }
}
