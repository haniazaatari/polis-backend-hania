import { CommentCoverageMetrics } from "../types";
import { parse } from "csv-parse/sync";
import { sendCommentGroupsSummary } from "../../export";
import { PolisRecord } from "../types";

// Function to extract cited comment IDs from model response
export const extractCitedCommentIds = (
  modelResponse: string | null
): number[] => {
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

// Function to get total comment count for a conversation
export const getTotalCommentCount = async (zid: number): Promise<number> => {
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

// Function to log metrics in a consistent format
export const logCoverageMetrics = (
  sectionName: string,
  metrics: CommentCoverageMetrics
): void => {
  console.log(`\n=== COMMENT COVERAGE FOR ${sectionName.toUpperCase()} ===`);
  console.log(`TOTAL COMMENTS IN CONVERSATION: ${metrics.totalComments}`);
  console.log(`TOTAL COMMENTS PASSING FILTER: ${metrics.filteredComments}`);
  console.log(`CITATIONS SELECTED BY MODEL: ${metrics.citedComments}`);
  console.log(`COMMENTS LEFT OUT BY MODEL: ${metrics.omittedComments}`);
  console.log("=======================================\n");
};
