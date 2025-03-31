import crypto from 'crypto';
import { queryP, queryP_readOnly } from '../db/pg-query.js';
import logger from '../utils/logger.js';

function generateUuid() {
  return crypto.randomUUID();
}

export async function handle_GET_conversationUuid(req, res) {
  const { zid } = req.p;
  try {
    const queryResult = await queryP_readOnly('SELECT uuid FROM zinvites WHERE zid = $1', [zid]);
    const existingRows = queryResult;
    if (existingRows.length === 0) {
      throw new Error(`No zinvite found for zid: ${zid}`);
    }
    let uuid = existingRows[0].uuid;
    if (!uuid) {
      uuid = generateUuid();
      await queryP('UPDATE zinvites SET uuid = $1 WHERE zid = $2', [uuid, zid]);
    }
    res.json({
      conversation_uuid: uuid
    });
  } catch (err) {
    logger.error(`Error retrieving/creating UUID for zid ${zid}:`, err);
    res.json({
      error: 'Error retrieving or creating conversation UUID'
    });
  }
}
