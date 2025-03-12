import { GoogleAIModel } from '@tevko/sensemaking-tools/src/models/aiStudio_model.js';
import { Sensemaker } from '@tevko/sensemaking-tools/src/sensemaker.js';
import { VoteTally } from '@tevko/sensemaking-tools/src/types.js';
import { parse } from 'csv-parse';
import Config from '../../config.js';
import { sendCommentGroupsSummary } from '../../routes/export.js';
import logger from '../../utils/logger.js';

async function parseCsvString(csvString) {
  return new Promise((resolve, reject) => {
    const data = [];
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true
    });
    parser.on('error', (error) => reject(error));
    parser.on('data', (row) => {
      if (row.moderated === -1) {
        return;
      }
      data.push({
        text: row.comment_text,
        id: row['comment-id'].toString(),
        voteTalliesByGroup: {
          'group-0': new VoteTally(
            Number(row['group-0-agree-count']),
            Number(row['group-0-disagree-count']),
            Number(row['group-0-pass-count'])
          ),
          'group-1': new VoteTally(
            Number(row['group-1-agree-count']),
            Number(row['group-1-disagree-count']),
            Number(row['group-1-pass-count'])
          )
        }
      });
    });
    parser.on('end', () => resolve(data));
    parser.write(csvString);
    parser.end();
  });
}

export async function getTopicsFromRID(zId) {
  try {
    if (!Config.geminiApiKey) {
      throw new Error('polis_err_gemini_api_key_not_set');
    }
    const resp = await getCommentGroupsSummary(zId);
    const modified = resp.split('\n');
    modified[0] =
      'comment-id,comment_text,total-votes,total-agrees,total-disagrees,total-passes,group-a-votes,group-0-agree-count,group-0-disagree-count,group-0-pass-count,group-b-votes,group-1-agree-count,group-1-disagree-count,group-1-pass-count';
    const comments = await parseCsvString(modified.join('\n'));
    const topics = await new Sensemaker({
      defaultModel: new GoogleAIModel(Config.geminiApiKey, 'gemini-exp-1206')
    }).learnTopics(comments, false);
    const categorizedComments = await new Sensemaker({
      defaultModel: new GoogleAIModel(Config.geminiApiKey, 'gemini-1.5-flash-8b')
    }).categorizeComments(comments, false, topics);
    const topics_master_list = new Map();

    for (const c of categorizedComments) {
      if (c.topics) {
        for (const t of c.topics) {
          const existingTopic = topics_master_list.get(t.name);
          if (existingTopic) {
            existingTopic.citations.push(Number(c.id));
          } else {
            topics_master_list.set(t.name, { citations: [Number(c.id)] });
          }
        }
      }
    }

    return Array.from(topics_master_list, ([name, value]) => ({
      name,
      citations: value.citations
    }));
  } catch (error) {
    logger.error(error);
    return [];
  }
}
