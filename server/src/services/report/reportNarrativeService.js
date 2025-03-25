import Anthropic from '@anthropic-ai/sdk';
import { countTokens } from '@anthropic-ai/tokenizer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { parse } from 'csv-parse/sync';
import fs from 'fs/promises';
import js2xmlparser from 'js2xmlparser';
import OpenAI from 'openai';
import simpleXmlToJson from 'simple-xml-to-json';
import { create } from 'xmlbuilder2';
import config from '../../config.js';
import * as db from '../../db/index.js';
import { getTopicsFromRID } from '../../report_experimental/topics-example/index.js';
import { getCommentGroupsSummary } from '../../services/export/exportService.js';
import logger from '../../utils/logger.js';
import { DynamoStorageService } from '../../utils/storage.js';

const { convertXML } = simpleXmlToJson;
const anthropic = config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;
const genAI = config.googleApiKey ? new GoogleGenerativeAI(config.googleApiKey) : null;

/**
 * Convert CSV content to XML format
 * @param {string} csvContent - CSV content to convert
 * @returns {string} - XML string
 */
export function convertToXml(csvContent) {
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true
  });

  if (records.length === 0) return '';

  const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele('polis-comments');

  for (const record of records) {
    const comment = doc.ele('comment', {
      id: record['comment-id'],
      group: record['group-id'] || '',
      agrees: record.agrees || '',
      disagrees: record.disagrees || '',
      passes: record.passes || '',
      moderated: record.moderated || '',
      moderation: record.moderation || ''
    });

    comment.ele('text').txt(record.comment || '');

    if (record.topics) {
      const topics = record.topics
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (topics.length > 0) {
        const topicsEle = comment.ele('topics');
        for (const topic of topics) {
          topicsEle.ele('topic').txt(topic);
        }
      }
    }
  }

  return doc.end({ prettyPrint: true });
}

/**
 * Convert a file to XML
 * @param {string} filePath - Path to the file
 * @returns {Promise<string>} - XML string
 */
export async function convertFromFile(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return convertToXml(content);
}

/**
 * Validate CSV structure
 * @param {string[]} headers - CSV headers
 * @returns {boolean} - True if valid
 */
export function validateCsvStructure(headers) {
  const requiredHeaders = ['comment-id', 'comment'];
  return requiredHeaders.every((h) => headers.includes(h));
}

/**
 * Get comments as XML
 * @param {number} id - Conversation ID
 * @param {Function} filter - Filter function (optional)
 * @returns {Promise<string>} - XML string
 */
const getCommentsAsXML = async (id, filter) => {
  try {
    const result = await getCommentGroupsSummary(id, filter);
    return convertToXml(result);
  } catch (error) {
    logger.error('Error getting comments as XML:', error);
    throw error;
  }
};

/**
 * Check if data is fresh
 * @param {number} timestamp - Timestamp
 * @returns {boolean} - True if fresh
 */
const isFreshData = (timestamp) => {
  if (!timestamp) return false;
  const now = Date.now();
  return now - timestamp < config.maxReportCacheDuration || 24 * 60 * 60 * 1000; // 24 hours default
};

/**
 * Get model response
 * @param {string} model - Model name
 * @param {string} system_lore - System lore
 * @param {string} prompt_xml - Prompt XML
 * @param {string} modelVersion - Model version
 * @param {boolean} isTopic - Whether this is a topic
 * @returns {Promise<string>} - Model response
 */
const getModelResponse = async (model, system_lore, prompt_xml, modelVersion, isTopic) => {
  try {
    if (isTopic && countTokens(prompt_xml) > 30000) {
      return `{
        "id": "polis_narrative_error_message",
        "title": "Too many comments",
        "paragraphs": [
          {
            "id": "polis_narrative_error_message",
            "title": "Too many comments",
            "sentences": [
              {
                "clauses": [
                  {
                    "text": "There are currently too many comments in this conversation for our AI to generate a topic response",
                    "citations": []
                  }
                ]
              }
            ]
          }
        ]
      }`;
    }

    const gemeniModel = genAI?.getGenerativeModel({
      model: modelVersion || 'gemini-2.0-pro-exp-02-05',
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 50000
      }
    });

    const gemeniModelprompt = {
      contents: [
        {
          parts: [
            {
              text: `
                ${prompt_xml}

                You MUST respond with a JSON object that follows this EXACT structure:

                \`\`\`json
                {
                  "key1": "string value",
                  "key2": [
                    {
                      "nestedKey1": 123,
                      "nestedKey2": "another string"
                    }
                  ],
                  "key3": true
                }
                \`\`\`

                Make sure the JSON is VALID. DO NOT begin with an array '[' - begin with an object '{' - All keys MUST be enclosed in double quotes. NO trailing comma's should be included after the last element in a block (not valid json). Do NOT include any additional text outside of the JSON object. Do not provide explanations, only the JSON.
              `
            }
          ],
          role: 'user'
        }
      ],
      systemInstruction: system_lore
    };

    const openai = config.openaiApiKey
      ? new OpenAI({
          apiKey: config.openaiApiKey
        })
      : null;

    switch (model) {
      case 'gemini': {
        if (!gemeniModel) {
          throw new Error('polis_err_gemini_api_key_not_set');
        }
        const respGem = await gemeniModel.generateContent(gemeniModelprompt);
        const result = await respGem.response.text();
        return result;
      }
      case 'claude': {
        if (!anthropic) {
          throw new Error('polis_err_anthropic_api_key_not_set');
        }
        const responseClaude = await anthropic.messages.create({
          model: modelVersion || 'claude-3-7-sonnet-20250219',
          max_tokens: 3000,
          temperature: 0,
          system: system_lore,
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: prompt_xml }]
            },
            {
              role: 'assistant',
              content: [{ type: 'text', text: '{' }]
            }
          ]
        });
        return `{${responseClaude?.content[0]?.text}`;
      }
      case 'openai': {
        if (!openai) {
          throw new Error('polis_err_openai_api_key_not_set');
        }
        const responseOpenAI = await openai.chat.completions.create({
          model: modelVersion || 'gpt-4o',
          messages: [
            { role: 'system', content: system_lore },
            { role: 'user', content: prompt_xml }
          ]
        });
        return responseOpenAI.choices[0].message.content;
      }
      default:
        return '';
    }
  } catch (error) {
    logger.error('ERROR IN GETMODELRESPONSE', error);
    return `{
      "id": "polis_narrative_error_message",
      "title": "Narrative Error Message",
      "paragraphs": [
        {
          "id": "polis_narrative_error_message",
          "title": "Narrative Error Message",
          "sentences": [
            {
              "clauses": [
                {
                  "text": "There was an error generating the narrative. Please refresh the page once all sections have been generated. It may also be a problem with this model, especially if your content discussed sensitive topics.",
                  "citations": []
                }
              ]
            }
          ]
        }
      ]
    }`;
  }
};

/**
 * Get GAC threshold by group count
 * @param {number} numGroups - Number of groups
 * @returns {number} - Threshold
 */
const getGacThresholdByGroupCount = (numGroups) => {
  const thresholds = {
    2: 0.7,
    3: 0.47,
    4: 0.32,
    5: 0.24
  };
  return thresholds[numGroups] ?? 0.24;
};

/**
 * Initialize report narrative service
 * @param {string} rid - Report ID
 * @param {boolean} noCache - Whether to use cache
 * @returns {Promise<{storage: DynamoStorageService, zid: number, system_lore: string}>}
 */
export async function initReportNarrativeService(rid, noCache = false) {
  const storage = new DynamoStorageService('report_narrative_store', noCache);
  await storage.initTable();

  const zid = await db.getZidForRid(rid);
  if (!zid) {
    throw new Error('polis_error_report_narrative_notfound');
  }

  const system_lore = await fs.readFile('src/report_experimental/system.xml', 'utf8');

  return { storage, zid, system_lore };
}

/**
 * Generate group informed consensus
 * @param {string} rid - Report ID
 * @param {DynamoStorageService} storage - Storage service
 * @param {object} res - Response object
 * @param {string} model - Model name
 * @param {string} system_lore - System lore
 * @param {number} zid - Conversation ID
 * @param {string} modelVersion - Model version
 * @returns {Promise<void>}
 */
export async function generateGroupInformedConsensus(rid, storage, res, model, system_lore, zid, modelVersion) {
  const section = {
    name: 'group_informed_consensus',
    templatePath: 'src/report_experimental/subtaskPrompts/group_informed_consensus.xml',
    filter: (v) => (v.group_aware_consensus ?? 0) > getGacThresholdByGroupCount(v.num_groups)
  };

  const cachedResponse = await storage?.queryItemsByRidSectionModel(`${rid}#${section.name}#${model}`);
  const structured_comments = await getCommentsAsXML(zid, section.filter);

  if (Array.isArray(cachedResponse) && cachedResponse?.length && isFreshData(cachedResponse[0].timestamp)) {
    res.write(
      `${JSON.stringify({
        [section.name]: {
          modelResponse: cachedResponse[0].report_data,
          model,
          errors: structured_comments?.trim().length === 0 ? 'NO_CONTENT_AFTER_FILTER' : undefined
        }
      })}|||`
    );
  } else {
    const fileContents = await fs.readFile(section.templatePath, 'utf8');
    const json = await convertXML(fileContents);

    if (Array.isArray(cachedResponse) && cachedResponse?.length) {
      storage?.deleteReportItem(cachedResponse[0].rid_section_model, cachedResponse[0].timestamp);
    }

    json.polisAnalysisPrompt.children[json.polisAnalysisPrompt.children.length - 1].data.content = {
      structured_comments
    };

    const prompt_xml = js2xmlparser.parse('polis-comments-and-group-demographics', json);
    const resp = await getModelResponse(model, system_lore, prompt_xml, modelVersion);

    const reportItem = {
      rid_section_model: `${rid}#${section.name}#${model}`,
      timestamp: new Date().toISOString(),
      report_data: resp,
      model,
      errors: structured_comments?.trim().length === 0 ? 'NO_CONTENT_AFTER_FILTER' : undefined
    };

    storage?.putItem(reportItem);

    res.write(
      `${JSON.stringify({
        [section.name]: {
          modelResponse: resp,
          model,
          errors: structured_comments?.trim().length === 0 ? 'NO_CONTENT_AFTER_FILTER' : undefined
        }
      })}|||`
    );
  }

  res.flush();
}

/**
 * Generate uncertainty
 * @param {string} rid - Report ID
 * @param {DynamoStorageService} storage - Storage service
 * @param {object} res - Response object
 * @param {string} model - Model name
 * @param {string} system_lore - System lore
 * @param {number} zid - Conversation ID
 * @param {string} modelVersion - Model version
 * @returns {Promise<void>}
 */
export async function generateUncertainty(rid, storage, res, model, system_lore, zid, modelVersion) {
  const section = {
    name: 'uncertainty',
    templatePath: 'src/report_experimental/subtaskPrompts/uncertainty.xml',
    filter: (v) => v.passes / v.votes >= 0.2
  };

  const cachedResponse = await storage?.queryItemsByRidSectionModel(`${rid}#${section.name}#${model}`);
  const structured_comments = await getCommentsAsXML(zid, section.filter);

  if (Array.isArray(cachedResponse) && cachedResponse?.length && isFreshData(cachedResponse[0].timestamp)) {
    res.write(
      `${JSON.stringify({
        [section.name]: {
          modelResponse: cachedResponse[0].report_data,
          model,
          errors: structured_comments?.trim().length === 0 ? 'NO_CONTENT_AFTER_FILTER' : undefined
        }
      })}|||`
    );
  } else {
    const fileContents = await fs.readFile(section.templatePath, 'utf8');
    const json = await convertXML(fileContents);

    if (Array.isArray(cachedResponse) && cachedResponse?.length) {
      storage?.deleteReportItem(cachedResponse[0].rid_section_model, cachedResponse[0].timestamp);
    }

    json.polisAnalysisPrompt.children[json.polisAnalysisPrompt.children.length - 1].data.content = {
      structured_comments
    };

    const prompt_xml = js2xmlparser.parse('polis-comments-and-group-demographics', json);
    const resp = await getModelResponse(model, system_lore, prompt_xml, modelVersion);

    const reportItem = {
      rid_section_model: `${rid}#${section.name}#${model}`,
      timestamp: new Date().toISOString(),
      report_data: resp,
      model,
      errors: structured_comments?.trim().length === 0 ? 'NO_CONTENT_AFTER_FILTER' : undefined
    };

    storage?.putItem(reportItem);

    res.write(
      `${JSON.stringify({
        [section.name]: {
          modelResponse: resp,
          model,
          errors: structured_comments?.trim().length === 0 ? 'NO_CONTENT_AFTER_FILTER' : undefined
        }
      })}|||`
    );
  }

  res.flush();
}

/**
 * Generate groups
 * @param {string} rid - Report ID
 * @param {DynamoStorageService} storage - Storage service
 * @param {object} res - Response object
 * @param {string} model - Model name
 * @param {string} system_lore - System lore
 * @param {number} zid - Conversation ID
 * @param {string} modelVersion - Model version
 * @returns {Promise<void>}
 */
export async function generateGroups(rid, storage, res, model, system_lore, zid, modelVersion) {
  const section = {
    name: 'groups',
    templatePath: 'src/report_experimental/subtaskPrompts/groups.xml',
    filter: (v) => (v.comment_extremity ?? 0) > 1
  };

  const cachedResponse = await storage?.queryItemsByRidSectionModel(`${rid}#${section.name}#${model}`);
  const structured_comments = await getCommentsAsXML(zid, section.filter);

  if (Array.isArray(cachedResponse) && cachedResponse?.length && isFreshData(cachedResponse[0].timestamp)) {
    res.write(
      `${JSON.stringify({
        [section.name]: {
          modelResponse: cachedResponse[0].report_data,
          model,
          errors: structured_comments?.trim().length === 0 ? 'NO_CONTENT_AFTER_FILTER' : undefined
        }
      })}|||`
    );
  } else {
    const fileContents = await fs.readFile(section.templatePath, 'utf8');
    const json = await convertXML(fileContents);

    if (Array.isArray(cachedResponse) && cachedResponse?.length) {
      storage?.deleteReportItem(cachedResponse[0].rid_section_model, cachedResponse[0].timestamp);
    }

    json.polisAnalysisPrompt.children[json.polisAnalysisPrompt.children.length - 1].data.content = {
      structured_comments
    };

    const prompt_xml = js2xmlparser.parse('polis-comments-and-group-demographics', json);
    const resp = await getModelResponse(model, system_lore, prompt_xml, modelVersion);

    const reportItem = {
      rid_section_model: `${rid}#${section.name}#${model}`,
      timestamp: new Date().toISOString(),
      report_data: resp,
      model,
      errors: structured_comments?.trim().length === 0 ? 'NO_CONTENT_AFTER_FILTER' : undefined
    };

    storage?.putItem(reportItem);

    res.write(
      `${JSON.stringify({
        [section.name]: {
          modelResponse: resp,
          model,
          errors: structured_comments?.trim().length === 0 ? 'NO_CONTENT_AFTER_FILTER' : undefined
        }
      })}|||`
    );
  }

  res.flush();
}

/**
 * Generate topics
 * @param {string} rid - Report ID
 * @param {DynamoStorageService} storage - Storage service
 * @param {object} res - Response object
 * @param {string} model - Model name
 * @param {string} system_lore - System lore
 * @param {number} zid - Conversation ID
 * @param {string} modelVersion - Model version
 * @returns {Promise<void>}
 */
export async function generateTopics(rid, storage, res, model, system_lore, zid, modelVersion) {
  let topics;
  const cachedTopics = await storage?.queryItemsByRidSectionModel(`${rid}#topics`);

  if (cachedTopics?.length && isFreshData(cachedTopics[0].timestamp)) {
    topics = cachedTopics[0].report_data;
  } else {
    if (cachedTopics?.length) {
      storage?.deleteReportItem(cachedTopics[0].rid_section_model, cachedTopics[0].timestamp);
    }

    topics = await getTopicsFromRID(zid);

    const reportItemTopics = {
      rid_section_model: `${rid}#topics`,
      model,
      timestamp: new Date().toISOString(),
      report_data: topics
    };

    storage?.putItem(reportItemTopics);
  }

  const sections = topics.map((topic) => ({
    name: `topic_${topic.name.toLowerCase().replace(/\s+/g, '_')}`,
    templatePath: 'src/report_experimental/subtaskPrompts/topics.xml',
    filter: (v) => {
      return topic.citations.includes(v.comment_id);
    }
  }));

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const cachedResponse = await storage?.queryItemsByRidSectionModel(`${rid}#${section.name}#${model}`);
    const structured_comments = await getCommentsAsXML(zid, section.filter);

    if (Array.isArray(cachedResponse) && cachedResponse?.length && isFreshData(cachedResponse[0].timestamp)) {
      res.write(
        `${JSON.stringify({
          [section.name]: {
            modelResponse: cachedResponse[0].report_data,
            model,
            errors: structured_comments?.trim().length === 0 ? 'NO_CONTENT_AFTER_FILTER' : undefined
          }
        })}|||`
      );

      if (sections.length - 1 === i) {
        logger.debug('all promises completed');
        res.end();
      }
    } else {
      const fileContents = await fs.readFile(section.templatePath, 'utf8');
      const json = await convertXML(fileContents);

      if (Array.isArray(cachedResponse) && cachedResponse?.length) {
        storage?.deleteReportItem(cachedResponse[0].rid_section_model, cachedResponse[0].timestamp);
      }

      json.polisAnalysisPrompt.children[json.polisAnalysisPrompt.children.length - 1].data.content = {
        structured_comments
      };

      const prompt_xml = js2xmlparser.parse('polis-comments-and-group-demographics', json);

      setTimeout(async () => {
        const resp = await getModelResponse(model, system_lore, prompt_xml, modelVersion, true);

        const reportItem = {
          rid_section_model: `${rid}#${section.name}#${model}`,
          timestamp: new Date().toISOString(),
          model,
          report_data: resp,
          errors: structured_comments?.trim().length === 0 ? 'NO_CONTENT_AFTER_FILTER' : undefined
        };

        storage?.putItem(reportItem);

        res.write(
          `${JSON.stringify({
            [section.name]: {
              modelResponse: resp,
              model,
              errors: structured_comments?.trim().length === 0 ? 'NO_CONTENT_AFTER_FILTER' : undefined
            }
          })}|||`
        );

        logger.debug(`topic over: ${section.name}`);
        res.flush();

        if (sections.length - 1 === i) {
          logger.debug('all promises completed');
          res.end();
        }
      }, 500 * i);
    }
  }
}

/**
 * Generate report narrative
 * @param {string} rid - Report ID
 * @param {object} res - Response object
 * @param {string} model - Model name
 * @param {string} modelVersion - Model version
 * @param {boolean} noCache - Whether to use cache
 * @returns {Promise<void>}
 */
export async function generateReportNarrative(rid, res, model, modelVersion, noCache = false) {
  try {
    const { storage, zid, system_lore } = await initReportNarrativeService(rid, noCache);

    res.write('POLIS-PING: AI bootstrap\n');
    res.flush();

    res.write('POLIS-PING: retrieving system lore\n');
    res.flush();

    res.write('POLIS-PING: retrieving stream\n');
    res.flush();

    const promises = [
      generateGroupInformedConsensus(rid, storage, res, model, system_lore, zid, modelVersion),
      generateUncertainty(rid, storage, res, model, system_lore, zid, modelVersion),
      generateGroups(rid, storage, res, model, system_lore, zid, modelVersion),
      generateTopics(rid, storage, res, model, system_lore, zid, modelVersion)
    ];

    await Promise.all(promises);
  } catch (err) {
    logger.error('Error generating report narrative:', err);
    throw err;
  }
}
