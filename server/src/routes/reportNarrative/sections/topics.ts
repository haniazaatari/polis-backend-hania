import fs from "fs/promises";
import { convertXML } from "simple-xml-to-json";
import { parseToXml } from "../../../utils/xml";
import { getCommentsAsXML } from "../utils/comments";
import { isFreshData } from "../utils/caching";
import { getModelResponse } from "../models/modelService";
import {
  extractCitedCommentIds,
  logCoverageMetrics,
} from "../coverage/metrics";
import { CommentCoverageMetrics, SectionHandlerParams } from "../types";
import { getTopicsFromRID } from "../utils/topics";
import { PathLike } from "fs";
import { logModelCoverage } from "../utils/coverageDebug";

export async function handle_GET_topics({
  rid,
  storage,
  res,
  model,
  system_lore,
  zid,
  modelVersion,
  totalComments,
}: SectionHandlerParams) {
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
      templatePath: "src/routes/reportNarrative/prompts/subtasks/topics.xml",
      filter: (v: { comment_id: number }) => {
        // Check if the comment_id is in the citations array for this topic
        return topic.citations.includes(v.comment_id);
      },
    })
  );

  sections.forEach(
    async (
      section: {
        name: string;
        templatePath: PathLike | fs.FileHandle;
        filter: (v: { comment_id: number }) => boolean;
      },
      i: number,
      arr: any[]
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
        logCoverageMetrics(section.name, metrics);

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

        const prompt_xml = parseToXml(
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

          // Add this line to log coverage data
          if (process.env.DEBUG_NARRATIVE_COVERAGE_WRITE_TO_DISK === "true") {
            await logModelCoverage(
              "topics",
              rid,
              zid as number,
              commentsResult.xml, // All comments sent to the model
              resp // The model's response
            );
          }

          // Extract cited comments from response
          const citedCommentIds = extractCitedCommentIds(resp);
          metrics.citedComments = citedCommentIds.length;
          metrics.omittedComments = filteredCount - citedCommentIds.length;

          // Log metrics
          logCoverageMetrics(section.name, metrics);

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
