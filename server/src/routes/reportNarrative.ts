/* eslint-disable no-console */
import { Response } from "express";
import fail from "../utils/fail";
import { getZidForRid } from "../utils/zinvite";

import Anthropic from "@anthropic-ai/sdk";
import {
  GenerateContentRequest,
  GoogleGenerativeAI,
} from "@google/generative-ai";
import OpenAI from "openai";
import { convertXML } from "simple-xml-to-json";
import fs from "fs/promises";
import { parse } from "csv-parse/sync";
import { create } from "xmlbuilder2";
import { sendCommentGroupsSummary } from "./export";
import { getTopicsFromRID } from "../report_experimental/topics-example";
import DynamoStorageService from "../utils/storage";
import { PathLike } from "fs";

const js2xmlparser = require("js2xmlparser");

interface PolisRecord {
  [key: string]: string; // Allow any string keys
}

export class PolisConverter {
  static convertToXml(csvContent: string): string {
    // Parse CSV content
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    }) as PolisRecord[];

    if (records.length === 0) return "";

    // Create XML document
    const doc = create({ version: "1.0", encoding: "UTF-8" }).ele(
      "polis-comments"
    );

    // Process each record
    records.forEach((record) => {
      // Extract base comment data
      const comment = doc.ele("comment", {
        id: record["comment-id"],
        votes: record["total-votes"],
        agrees: record["total-agrees"],
        disagrees: record["total-disagrees"],
        passes: record["total-passes"],
      });

      // Add comment text
      comment.ele("text").txt(record["comment"]);

      // Find and process all group data
      const groupKeys = Object.keys(record)
        .filter((key) => key.match(/^group-[a-z]-/))
        .reduce((groups, key) => {
          const groupId = key.split("-")[1]; // Extract "a" from "group-a-votes"
          if (!groups.includes(groupId)) groups.push(groupId);
          return groups;
        }, [] as string[]);

      // Add data for each group
      groupKeys.forEach((groupId) => {
        comment.ele(`group-${groupId}`, {
          votes: record[`group-${groupId}-votes`],
          agrees: record[`group-${groupId}-agrees`],
          disagrees: record[`group-${groupId}-disagrees`],
          passes: record[`group-${groupId}-passes`],
        });
      });
    });

    // Return formatted XML string
    return doc.end({ prettyPrint: true });
  }

  static async convertFromFile(filePath: string): Promise<string> {
    const fs = await import("fs/promises");
    const csvContent = await fs.readFile(filePath, "utf-8");
    return PolisConverter.convertToXml(csvContent);
  }

  // Helper method to validate CSV structure
  static validateCsvStructure(headers: string[]): boolean {
    const requiredBaseFields = [
      "comment-id",
      "comment",
      "total-votes",
      "total-agrees",
      "total-disagrees",
      "total-passes",
    ];

    const hasRequiredFields = requiredBaseFields.every((field) =>
      headers.includes(field)
    );

    // Check if group fields follow the expected pattern
    const groupFields = headers.filter((h) => h.startsWith("group-"));
    const validGroupPattern = groupFields.every((field) =>
      field.match(/^group-[a-z]-(?:votes|agrees|disagrees|passes)$/)
    );

    return hasRequiredFields && validGroupPattern;
  }
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);

// Add this interface to track comment coverage metrics
interface CommentCoverageMetrics {
  totalComments: number;
  filteredComments: number;
  citedComments: number;
  omittedComments: number;
}

// Add this function to get total comment count for a conversation
const getTotalCommentCount = async (zid: number): Promise<number> => {
  try {
    const resp = await sendCommentGroupsSummary(zid, undefined, false);
    const records = parse(resp as string, {
      columns: true,
      skip_empty_lines: true,
    }) as PolisRecord[];
    return records.length;
  } catch (e) {
    console.error("Error getting total comment count:", e);
    return 0;
  }
};

// Update the extractCitedCommentIds function to handle null responses
const extractCitedCommentIds = (modelResponse: string | null): number[] => {
  if (!modelResponse) return [];

  try {
    const responseObj = JSON.parse(modelResponse);
    const citedCommentIds = new Set<number>();

    // Extract citations from paragraphs
    if (responseObj.paragraphs) {
      responseObj.paragraphs.forEach((paragraph: any) => {
        if (paragraph.sentences) {
          paragraph.sentences.forEach((sentence: any) => {
            if (sentence.clauses) {
              sentence.clauses.forEach((clause: any) => {
                if (clause.citations && Array.isArray(clause.citations)) {
                  clause.citations.forEach((citation: any) => {
                    if (citation.comment_id) {
                      citedCommentIds.add(Number(citation.comment_id));
                    }
                  });
                }
              });
            }
          });
        }
      });
    }

    return Array.from(citedCommentIds);
  } catch (e) {
    console.error("Error extracting cited comment IDs:", e);
    return [];
  }
};

// Modify getCommentsAsXML to return both XML and filtered comment count
const getCommentsAsXML = async (
  id: number,
  filter?: (v: {
    votes: number;
    agrees: number;
    disagrees: number;
    passes: number;
    group_aware_consensus?: number;
    comment_extremity?: number;
    comment_id: number;
  }) => boolean
): Promise<{ xml: string; filteredCount: number }> => {
  try {
    const resp = await sendCommentGroupsSummary(id, undefined, false, filter);
    const xml = PolisConverter.convertToXml(resp as string);

    // Count filtered comments
    const records = parse(resp as string, {
      columns: true,
      skip_empty_lines: true,
    }) as PolisRecord[];
    const filteredCount = records.length;

    // eslint-disable-next-line no-console
    if (xml.trim().length === 0)
      console.error("No data has been returned by sendCommentGroupsSummary");
    return { xml, filteredCount };
  } catch (e) {
    console.error("Error in getCommentsAsXML:", e);
    throw e; // Re-throw instead of returning empty string
  }
};

type QueryParams = {
  [key: string]: string | string[] | undefined;
};

const isFreshData = (timestamp: string) => {
  const now = new Date().getTime();
  const then = new Date(timestamp).getTime();
  const elapsed = Math.abs(now - then);
  return (
    elapsed <
    (((process.env.MAX_REPORT_CACHE_DURATION as unknown) as number) || 3600000)
  );
};

const getModelResponse = async (
  model: string,
  system_lore: string,
  prompt_xml: string,
  modelVersion?: string
) => {
  try {
    const gemeniModel = genAI.getGenerativeModel({
      // model: "gemini-1.5-pro-002",
      model: modelVersion || "gemini-2.0-pro-exp-02-05",
      generationConfig: {
        // https://cloud.google.com/vertex-ai/docs/reference/rest/v1/GenerationConfig
        responseMimeType: "application/json",
        maxOutputTokens: 50000, // high for reliability for now.
      },
    });
    const gemeniModelprompt: GenerateContentRequest = {
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
  
                  Make sure the JSON is VALID. DO NOT begin with an array '[' - begin with an object '{' - All keys MUST be enclosed in double quotes. NO trailing comma's should be included after the last element in a block (not valid json). Do NOT include any additional text outside of the JSON object.  Do not provide explanations, only the JSON.
                `,
            },
          ],
          role: "user",
        },
      ],
      systemInstruction: system_lore,
    };
    const openai = new OpenAI();

    switch (model) {
      case "gemini": {
        const respGem = await gemeniModel.generateContent(gemeniModelprompt);
        const result = await respGem.response.text();
        return result;
      }
      case "claude": {
        const responseClaude = await anthropic.messages.create({
          model: modelVersion || "claude-3-7-sonnet-20250219",
          max_tokens: 3000,
          temperature: 0,
          system: system_lore,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: prompt_xml }],
            },
            {
              role: "assistant",
              content: [{ type: "text", text: "{" }],
            },
          ],
        });
        // @ts-expect-error claude api
        return `{${responseClaude?.content[0]?.text}`;
      }
      case "openai": {
        const responseOpenAI = await openai.chat.completions.create({
          model: modelVersion || "gpt-4o",
          messages: [
            { role: "system", content: system_lore },
            { role: "user", content: prompt_xml },
          ],
        });
        return responseOpenAI.choices[0].message.content;
      }
      default:
        return "";
    }
  } catch (error) {
    console.error("ERROR IN GETMODELRESPONSE", error);
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

const getGacThresholdByGroupCount = (numGroups: number): number => {
  const thresholds: Record<number, number> = {
    2: 0.7,
    3: 0.47,
    4: 0.32,
    5: 0.24,
  };
  return thresholds[numGroups] ?? 0.24;
};

// Modify handle_GET_groupInformedConsensus to track comment coverage
export async function handle_GET_groupInformedConsensus(
  rid: string,
  storage: DynamoStorageService | undefined,
  res: Response<any, Record<string, any>>,
  model: string,
  system_lore: string,
  zid: number | undefined,
  modelVersion?: string,
  totalComments?: number
) {
  const section = {
    name: "group_informed_consensus",
    templatePath:
      "src/report_experimental/subtaskPrompts/group_informed_consensus.xml",
    filter: (v: {
      votes: number;
      agrees: number;
      disagrees: number;
      passes: number;
      group_aware_consensus?: number;
      comment_extremity?: number;
      comment_id: number;
      num_groups?: number;
    }) => {
      // Only apply filter if both properties exist
      if (v.group_aware_consensus !== undefined && v.num_groups !== undefined) {
        return (
          v.group_aware_consensus > getGacThresholdByGroupCount(v.num_groups)
        );
      }
      return false;
    },
  };

  const cachedResponse = await storage?.queryItemsByRidSectionModel(
    `${rid}#${section.name}#${model}`
  );

  // Get comments with count
  const commentsResult = await getCommentsAsXML(zid as number, section.filter);
  const structured_comments = commentsResult.xml;
  const filteredCount = commentsResult.filteredCount;

  // Coverage metrics
  const metrics: CommentCoverageMetrics = {
    totalComments: totalComments || 0,
    filteredComments: filteredCount,
    citedComments: 0,
    omittedComments: filteredCount, // Will update after getting response
  };

  // send cached response first if available
  if (
    Array.isArray(cachedResponse) &&
    cachedResponse?.length &&
    isFreshData(cachedResponse[0].timestamp)
  ) {
    // Extract cited comments from cached response
    const citedCommentIds = extractCitedCommentIds(
      cachedResponse[0].report_data
    );
    metrics.citedComments = citedCommentIds.length;
    metrics.omittedComments = filteredCount - citedCommentIds.length;

    // Log metrics
    console.log(`\n=== COMMENT COVERAGE FOR ${section.name.toUpperCase()} ===`);
    console.log(`TOTAL COMMENTS IN CONVERSATION: ${metrics.totalComments}`);
    console.log(`TOTAL COMMENTS PASSING FILTER: ${metrics.filteredComments}`);
    console.log(`CITATIONS SELECTED BY MODEL: ${metrics.citedComments}`);
    console.log(`COMMENTS LEFT OUT BY MODEL: ${metrics.omittedComments}`);
    console.log("=======================================\n");

    res.write(
      JSON.stringify({
        [section.name]: {
          modelResponse: cachedResponse[0].report_data,
          model,
          errors:
            structured_comments?.trim().length === 0
              ? "NO_CONTENT_AFTER_FILTER"
              : undefined,
          coverage: metrics,
        },
      }) + `|||`
    );
  } else {
    const fileContents = await fs.readFile(section.templatePath, "utf8");
    const json = await convertXML(fileContents);
    if (Array.isArray(cachedResponse) && cachedResponse?.length) {
      storage?.deleteReportItem(
        cachedResponse[0].rid_section_model,
        cachedResponse[0].timestamp
      );
    }
    json.polisAnalysisPrompt.children[
      json.polisAnalysisPrompt.children.length - 1
    ].data.content = { structured_comments };

    const prompt_xml = js2xmlparser.parse(
      "polis-comments-and-group-demographics",
      json
    );

    const resp = await getModelResponse(
      model,
      system_lore,
      prompt_xml,
      modelVersion
    );

    // Extract cited comments from response
    const citedCommentIds = extractCitedCommentIds(resp);
    metrics.citedComments = citedCommentIds.length;
    metrics.omittedComments = filteredCount - citedCommentIds.length;

    // Log metrics
    console.log(`\n=== COMMENT COVERAGE FOR ${section.name.toUpperCase()} ===`);
    console.log(`TOTAL COMMENTS IN CONVERSATION: ${metrics.totalComments}`);
    console.log(`TOTAL COMMENTS PASSING FILTER: ${metrics.filteredComments}`);
    console.log(`CITATIONS SELECTED BY MODEL: ${metrics.citedComments}`);
    console.log(`COMMENTS LEFT OUT BY MODEL: ${metrics.omittedComments}`);
    console.log("=======================================\n");

    const reportItem = {
      rid_section_model: `${rid}#${section.name}#${model}`,
      timestamp: new Date().toISOString(),
      report_data: resp,
      model,
      errors:
        structured_comments?.trim().length === 0
          ? "NO_CONTENT_AFTER_FILTER"
          : undefined,
      coverage: metrics,
    };

    storage?.putItem(reportItem);

    res.write(
      JSON.stringify({
        [section.name]: {
          modelResponse: resp,
          model,
          errors:
            structured_comments?.trim().length === 0
              ? "NO_CONTENT_AFTER_FILTER"
              : undefined,
          coverage: metrics,
        },
      }) + `|||`
    );
  }
  // @ts-expect-error flush - calling due to use of compression
  res.flush();
}

export async function handle_GET_uncertainty(
  rid: string,
  storage: DynamoStorageService | undefined,
  res: Response<any, Record<string, any>>,
  model: string,
  system_lore: string,
  zid: number | undefined,
  modelVersion?: string,
  totalComments?: number
) {
  const section = {
    name: "uncertainty",
    templatePath: "src/report_experimental/subtaskPrompts/uncertainty.xml",
    // Revert to original simple pass ratio check
    filter: (v: { passes: number; votes: number }) => v.passes / v.votes >= 0.2,
  };

  const cachedResponse = await storage?.queryItemsByRidSectionModel(
    `${rid}#${section.name}#${model}`
  );

  // Get comments with count
  const commentsResult = await getCommentsAsXML(zid as number, section.filter);
  const structured_comments = commentsResult.xml;
  const filteredCount = commentsResult.filteredCount;

  // Coverage metrics
  const metrics: CommentCoverageMetrics = {
    totalComments: totalComments || 0,
    filteredComments: filteredCount,
    citedComments: 0,
    omittedComments: filteredCount, // Will update after getting response
  };

  // send cached response first if available
  if (
    Array.isArray(cachedResponse) &&
    cachedResponse?.length &&
    isFreshData(cachedResponse[0].timestamp)
  ) {
    // Extract cited comments from cached response
    const citedCommentIds = extractCitedCommentIds(
      cachedResponse[0].report_data
    );
    metrics.citedComments = citedCommentIds.length;
    metrics.omittedComments = filteredCount - citedCommentIds.length;

    // Log metrics
    console.log(`\n=== COMMENT COVERAGE FOR ${section.name.toUpperCase()} ===`);
    console.log(`TOTAL COMMENTS IN CONVERSATION: ${metrics.totalComments}`);
    console.log(`TOTAL COMMENTS PASSING FILTER: ${metrics.filteredComments}`);
    console.log(`CITATIONS SELECTED BY MODEL: ${metrics.citedComments}`);
    console.log(`COMMENTS LEFT OUT BY MODEL: ${metrics.omittedComments}`);
    console.log("=======================================\n");

    res.write(
      JSON.stringify({
        [section.name]: {
          modelResponse: cachedResponse[0].report_data,
          model,
          errors:
            structured_comments?.trim().length === 0
              ? "NO_CONTENT_AFTER_FILTER"
              : undefined,
          coverage: metrics,
        },
      }) + `|||`
    );
  } else {
    const fileContents = await fs.readFile(section.templatePath, "utf8");
    const json = await convertXML(fileContents);
    if (Array.isArray(cachedResponse) && cachedResponse?.length) {
      storage?.deleteReportItem(
        cachedResponse[0].rid_section_model,
        cachedResponse[0].timestamp
      );
    }
    json.polisAnalysisPrompt.children[
      json.polisAnalysisPrompt.children.length - 1
    ].data.content = { structured_comments };

    const prompt_xml = js2xmlparser.parse(
      "polis-comments-and-group-demographics",
      json
    );

    const resp = await getModelResponse(
      model,
      system_lore,
      prompt_xml,
      modelVersion
    );

    // Extract cited comments from response
    const citedCommentIds = extractCitedCommentIds(resp);
    metrics.citedComments = citedCommentIds.length;
    metrics.omittedComments = filteredCount - citedCommentIds.length;

    // Log metrics
    console.log(`\n=== COMMENT COVERAGE FOR ${section.name.toUpperCase()} ===`);
    console.log(`TOTAL COMMENTS IN CONVERSATION: ${metrics.totalComments}`);
    console.log(`TOTAL COMMENTS PASSING FILTER: ${metrics.filteredComments}`);
    console.log(`CITATIONS SELECTED BY MODEL: ${metrics.citedComments}`);
    console.log(`COMMENTS LEFT OUT BY MODEL: ${metrics.omittedComments}`);
    console.log("=======================================\n");

    const reportItem = {
      rid_section_model: `${rid}#${section.name}#${model}`,
      timestamp: new Date().toISOString(),
      report_data: resp,
      model,
      errors:
        structured_comments?.trim().length === 0
          ? "NO_CONTENT_AFTER_FILTER"
          : undefined,
      coverage: metrics,
    };

    storage?.putItem(reportItem);

    res.write(
      JSON.stringify({
        [section.name]: {
          modelResponse: resp,
          model,
          errors:
            structured_comments?.trim().length === 0
              ? "NO_CONTENT_AFTER_FILTER"
              : undefined,
          coverage: metrics,
        },
      }) + `|||`
    );
  }
  // @ts-expect-error flush - calling due to use of compression
  res.flush();
}

export async function handle_GET_groups(
  rid: string,
  storage: DynamoStorageService | undefined,
  res: Response<any, Record<string, any>>,
  model: string,
  system_lore: string,
  zid: number | undefined,
  modelVersion?: string,
  totalComments?: number
) {
  const section = {
    name: "groups",
    templatePath: "src/report_experimental/subtaskPrompts/groups.xml",
    filter: (v: {
      votes: number;
      agrees: number;
      disagrees: number;
      passes: number;
      group_aware_consensus?: number;
      comment_extremity?: number;
      comment_id: number;
    }) => {
      return (v.comment_extremity ?? 0) > 1;
    },
  };

  const cachedResponse = await storage?.queryItemsByRidSectionModel(
    `${rid}#${section.name}#${model}`
  );

  // Get comments with count
  const commentsResult = await getCommentsAsXML(zid as number, section.filter);
  const structured_comments = commentsResult.xml;
  const filteredCount = commentsResult.filteredCount;

  // Coverage metrics
  const metrics: CommentCoverageMetrics = {
    totalComments: totalComments || 0,
    filteredComments: filteredCount,
    citedComments: 0,
    omittedComments: filteredCount, // Will update after getting response
  };

  // send cached response first if available
  if (
    Array.isArray(cachedResponse) &&
    cachedResponse?.length &&
    isFreshData(cachedResponse[0].timestamp)
  ) {
    // Extract cited comments from cached response
    const citedCommentIds = extractCitedCommentIds(
      cachedResponse[0].report_data
    );
    metrics.citedComments = citedCommentIds.length;
    metrics.omittedComments = filteredCount - citedCommentIds.length;

    // Log metrics
    console.log(`\n=== COMMENT COVERAGE FOR ${section.name.toUpperCase()} ===`);
    console.log(`TOTAL COMMENTS IN CONVERSATION: ${metrics.totalComments}`);
    console.log(`TOTAL COMMENTS PASSING FILTER: ${metrics.filteredComments}`);
    console.log(`CITATIONS SELECTED BY MODEL: ${metrics.citedComments}`);
    console.log(`COMMENTS LEFT OUT BY MODEL: ${metrics.omittedComments}`);
    console.log("=======================================\n");

    res.write(
      JSON.stringify({
        [section.name]: {
          modelResponse: cachedResponse[0].report_data,
          model,
          errors:
            structured_comments?.trim().length === 0
              ? "NO_CONTENT_AFTER_FILTER"
              : undefined,
          coverage: metrics,
        },
      }) + `|||`
    );
  } else {
    const fileContents = await fs.readFile(section.templatePath, "utf8");
    const json = await convertXML(fileContents);
    if (Array.isArray(cachedResponse) && cachedResponse?.length) {
      storage?.deleteReportItem(
        cachedResponse[0].rid_section_model,
        cachedResponse[0].timestamp
      );
    }
    json.polisAnalysisPrompt.children[
      json.polisAnalysisPrompt.children.length - 1
    ].data.content = { structured_comments };

    const prompt_xml = js2xmlparser.parse(
      "polis-comments-and-group-demographics",
      json
    );

    const resp = await getModelResponse(
      model,
      system_lore,
      prompt_xml,
      modelVersion
    );

    // Extract cited comments from response
    const citedCommentIds = extractCitedCommentIds(resp);
    metrics.citedComments = citedCommentIds.length;
    metrics.omittedComments = filteredCount - citedCommentIds.length;

    // Log metrics
    console.log(`\n=== COMMENT COVERAGE FOR ${section.name.toUpperCase()} ===`);
    console.log(`TOTAL COMMENTS IN CONVERSATION: ${metrics.totalComments}`);
    console.log(`TOTAL COMMENTS PASSING FILTER: ${metrics.filteredComments}`);
    console.log(`CITATIONS SELECTED BY MODEL: ${metrics.citedComments}`);
    console.log(`COMMENTS LEFT OUT BY MODEL: ${metrics.omittedComments}`);
    console.log("=======================================\n");

    const reportItem = {
      rid_section_model: `${rid}#${section.name}#${model}`,
      timestamp: new Date().toISOString(),
      report_data: resp,
      model,
      errors:
        structured_comments?.trim().length === 0
          ? "NO_CONTENT_AFTER_FILTER"
          : undefined,
      coverage: metrics,
    };

    storage?.putItem(reportItem);

    res.write(
      JSON.stringify({
        [section.name]: {
          modelResponse: resp,
          model,
          errors:
            structured_comments?.trim().length === 0
              ? "NO_CONTENT_AFTER_FILTER"
              : undefined,
          coverage: metrics,
        },
      }) + `|||`
    );
  }
  // @ts-expect-error flush - calling due to use of compression
  res.flush();
}

export async function handle_GET_topics(
  rid: string,
  storage: DynamoStorageService | undefined,
  res: Response<any, Record<string, any>>,
  model: string,
  system_lore: string,
  zid: number,
  modelVersion?: string,
  totalComments?: number
) {
  let topics;
  const cachedTopics = await storage?.queryItemsByRidSectionModel(
    `${rid}#topics`
  );

  if (cachedTopics?.length && isFreshData(cachedTopics[0].timestamp)) {
    topics = cachedTopics[0].report_data;
  } else {
    if (cachedTopics?.length) {
      storage?.deleteReportItem(
        cachedTopics[0].rid_section_model,
        cachedTopics[0].timestamp
      );
    }
    topics = await getTopicsFromRID(zid);
    const reportItemTopics = {
      rid_section_model: `${rid}#topics`,
      model,
      timestamp: new Date().toISOString(),
      report_data: topics,
    };

    storage?.putItem(reportItemTopics);
  }
  const sections = topics.map(
    (topic: { name: string; citations: number[] }) => ({
      name: `topic_${topic.name.toLowerCase().replace(/\s+/g, "_")}`,
      templatePath: "src/report_experimental/subtaskPrompts/topics.xml",
      filter: (v: { comment_id: number }) => {
        // Check if the comment_id is in the citations array for this topic
        return topic.citations.includes(v.comment_id);
      },
    })
  );

  sections.forEach(
    async (
      section: {
        name: any;
        templatePath: PathLike | fs.FileHandle;
        filter: (v: { comment_id: number }) => boolean;
      },
      i: number,
      arr: any
    ) => {
      const cachedResponse = await storage?.queryItemsByRidSectionModel(
        `${rid}#${section.name}#${model}`
      );

      // Get comments with count
      const commentsResult = await getCommentsAsXML(zid, section.filter);
      const structured_comments = commentsResult.xml;
      const filteredCount = commentsResult.filteredCount;

      // Coverage metrics
      const metrics: CommentCoverageMetrics = {
        totalComments: totalComments || 0,
        filteredComments: filteredCount,
        citedComments: 0,
        omittedComments: filteredCount, // Will update after getting response
      };

      // send cached response first if available
      if (
        Array.isArray(cachedResponse) &&
        cachedResponse?.length &&
        isFreshData(cachedResponse[0].timestamp)
      ) {
        // Extract cited comments from cached response
        const citedCommentIds = extractCitedCommentIds(
          cachedResponse[0].report_data
        );
        metrics.citedComments = citedCommentIds.length;
        metrics.omittedComments = filteredCount - citedCommentIds.length;

        // Log metrics
        console.log(
          `\n=== COMMENT COVERAGE FOR ${section.name.toUpperCase()} ===`
        );
        console.log(`TOTAL COMMENTS IN CONVERSATION: ${metrics.totalComments}`);
        console.log(
          `TOTAL COMMENTS PASSING FILTER: ${metrics.filteredComments}`
        );
        console.log(`CITATIONS SELECTED BY MODEL: ${metrics.citedComments}`);
        console.log(`COMMENTS LEFT OUT BY MODEL: ${metrics.omittedComments}`);
        console.log("=======================================\n");

        res.write(
          JSON.stringify({
            [section.name]: {
              modelResponse: cachedResponse[0].report_data,
              model,
              errors:
                structured_comments?.trim().length === 0
                  ? "NO_CONTENT_AFTER_FILTER"
                  : undefined,
              coverage: metrics,
            },
          }) + `|||`
        );
      } else {
        const fileContents = await fs.readFile(section.templatePath, "utf8");
        const json = await convertXML(fileContents);
        if (Array.isArray(cachedResponse) && cachedResponse?.length) {
          storage?.deleteReportItem(
            cachedResponse[0].rid_section_model,
            cachedResponse[0].timestamp
          );
        }
        json.polisAnalysisPrompt.children[
          json.polisAnalysisPrompt.children.length - 1
        ].data.content = { structured_comments };

        const prompt_xml = js2xmlparser.parse(
          "polis-comments-and-group-demographics",
          json
        );
        res.write(`POLIS-PING: calling topic timeout`);
        setTimeout(async () => {
          res.write(`POLIS-PING: calling topic`);
          const resp = await getModelResponse(
            model,
            system_lore,
            prompt_xml,
            modelVersion
          );

          // Extract cited comments from response
          const citedCommentIds = extractCitedCommentIds(resp);
          metrics.citedComments = citedCommentIds.length;
          metrics.omittedComments = filteredCount - citedCommentIds.length;

          // Log metrics
          console.log(
            `\n=== COMMENT COVERAGE FOR ${section.name.toUpperCase()} ===`
          );
          console.log(
            `TOTAL COMMENTS IN CONVERSATION: ${metrics.totalComments}`
          );
          console.log(
            `TOTAL COMMENTS PASSING FILTER: ${metrics.filteredComments}`
          );
          console.log(`CITATIONS SELECTED BY MODEL: ${metrics.citedComments}`);
          console.log(`COMMENTS LEFT OUT BY MODEL: ${metrics.omittedComments}`);
          console.log("=======================================\n");

          const reportItem = {
            rid_section_model: `${rid}#${section.name}#${model}`,
            timestamp: new Date().toISOString(),
            model,
            report_data: resp,
            errors:
              structured_comments?.trim().length === 0
                ? "NO_CONTENT_AFTER_FILTER"
                : undefined,
            coverage: metrics,
          };

          storage?.putItem(reportItem);

          res.write(
            JSON.stringify({
              [section.name]: {
                modelResponse: resp,
                model,
                errors:
                  structured_comments?.trim().length === 0
                    ? "NO_CONTENT_AFTER_FILTER"
                    : undefined,
                coverage: metrics,
              },
            }) + `|||`
          );
          console.log("topic over");
          // @ts-expect-error flush - calling due to use of compression
          res.flush();

          if (arr.length - 1 === i) {
            console.log("all promises completed");
            res.end();
          }
        }, 3000 * i);
      }
    }
  );
}

export async function handle_GET_reportNarrative(
  req: { p: { rid: string }; query: QueryParams },
  res: Response
) {
  let storage;
  if (process.env.AWS_REGION && process.env.AWS_REGION?.trim().length > 0) {
    storage = new DynamoStorageService(
      process.env.AWS_REGION,
      "report_narrative_store",
      req.query.noCache === "true"
    );
  }
  const modelParam = req.query.model || "openai";
  const modelVersionParam = req.query.modelVersion;

  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Transfer-Encoding": "chunked",
  });
  const { rid } = req.p;

  res.write(`POLIS-PING: AI bootstrap`);

  // @ts-expect-error flush - calling due to use of compression
  res.flush();

  const zid = await getZidForRid(rid);
  if (!zid) {
    fail(res, 404, "polis_error_report_narrative_notfound");
    return;
  }

  // Get total comment count for the conversation
  const totalComments = await getTotalCommentCount(zid);
  console.log(`\n=== COMMENT COVERAGE SUMMARY ===`);
  console.log(`TOTAL COMMENTS IN CONVERSATION: ${totalComments}`);
  console.log(`================================\n`);

  res.write(`POLIS-PING: retrieving system lore`);

  // @ts-expect-error flush - calling due to use of compression
  res.flush();

  const system_lore = await fs.readFile(
    "src/report_experimental/system.xml",
    "utf8"
  );

  res.write(`POLIS-PING: retrieving stream`);

  // @ts-expect-error flush - calling due to use of compression
  res.flush();
  try {
    const promises = [
      handle_GET_groupInformedConsensus(
        rid,
        storage,
        res,
        modelParam as string,
        system_lore,
        zid,
        modelVersionParam as string,
        totalComments
      ),
      handle_GET_uncertainty(
        rid,
        storage,
        res,
        modelParam as string,
        system_lore,
        zid,
        modelVersionParam as string,
        totalComments
      ),
      handle_GET_groups(
        rid,
        storage,
        res,
        modelParam as string,
        system_lore,
        zid,
        modelVersionParam as string,
        totalComments
      ),
      handle_GET_topics(
        rid,
        storage,
        res,
        modelParam as string,
        system_lore,
        zid,
        modelVersionParam as string,
        totalComments
      ),
    ];
    await Promise.all(promises);
  } catch (err) {
    // @ts-expect-error flush - calling due to use of compression
    res.flush();
    console.log(err);
    const msg =
      err instanceof Error && err.message && err.message.startsWith("polis_")
        ? err.message
        : "polis_err_report_narrative";
    fail(res, 500, msg, err);
  }
}
