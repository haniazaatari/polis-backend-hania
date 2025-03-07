import fs from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { parse } from 'csv-parse/sync';
import { convertXML } from 'simple-xml-to-json';
import { create } from 'xmlbuilder2';
import logger from '../../../utils/logger.js';

const js2xmlparser = require('js2xmlparser');
const report_id = process.argv[2];

// Convert class with static methods to exported functions
export function convertToXml(csvContent) {
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true
  });
  if (records.length === 0) return '';
  const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele('polis-comments');

  // Replace forEach with for...of
  for (const record of records) {
    const comment = doc.ele('comment', {
      id: record['comment-id'],
      votes: record['total-votes'],
      agrees: record['total-agrees'],
      disagrees: record['total-disagrees'],
      passes: record['total-passes']
    });
    comment.ele('text').txt(record.comment);
    const groupKeys = Object.keys(record)
      .filter((key) => key.match(/^group-[a-z]-/))
      .reduce((groups, key) => {
        const groupId = key.split('-')[1];
        if (!groups.includes(groupId)) groups.push(groupId);
        return groups;
      }, []);

    // Replace forEach with for...of
    for (const groupId of groupKeys) {
      comment.ele(`group-${groupId}`, {
        votes: record[`group-${groupId}-votes`],
        agrees: record[`group-${groupId}-agrees`],
        disagrees: record[`group-${groupId}-disagrees`],
        passes: record[`group-${groupId}-passes`]
      });
    }
  }
  return doc.end({ prettyPrint: true });
}

export async function convertFromFile(filePath) {
  const csvContent = await fs.readFile(filePath, 'utf-8');
  return convertToXml(csvContent);
}

export function validateCsvStructure(headers) {
  const requiredBaseFields = [
    'comment-id',
    'comment',
    'total-votes',
    'total-agrees',
    'total-disagrees',
    'total-passes'
  ];
  const hasRequiredFields = requiredBaseFields.every((field) => headers.includes(field));
  const groupFields = headers.filter((h) => h.startsWith('group-'));
  const validGroupPattern = groupFields.every((field) =>
    field.match(/^group-[a-z]-(?:votes|agrees|disagrees|passes)$/)
  );
  return hasRequiredFields && validGroupPattern;
}

const anthropic = new Anthropic({});
const getJSONuserMsg = async () => {
  const report_xml_template = await fs.readFile('src/prompts/report_experimental/subtasks/uncertainty.xml', 'utf8');
  const asJSON = await convertXML(report_xml_template);
  return asJSON;
};
const getCommentsAsJson = async (id) => {
  const resp = await fetch(`http://localhost/api/v3/reportExport/${id}/comment-groups.csv`);
  const data = await resp.text();
  const xml = convertToXml(data);
  return xml;
};
async function main() {
  const system_lore = await fs.readFile('src/prompts/report_experimental/system.xml', 'utf8');
  const json = await getJSONuserMsg();
  const structured_comments = await getCommentsAsJson(report_id);
  json.polisAnalysisPrompt.children[json.polisAnalysisPrompt.children.length - 1].data.content = {
    structured_comments
  };
  const prompt_xml = js2xmlparser.parse('polis-comments-and-group-demographics', json);
  logger.debug(prompt_xml);
  const msg = await anthropic.messages.create({
    model: 'claude-3-7-sonnet-20250219',
    max_tokens: 1000,
    temperature: 0,
    system: system_lore,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt_xml
          }
        ]
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: '{'
          }
        ]
      }
    ]
  });
  logger.debug(msg);
}
main().catch(logger.error);
