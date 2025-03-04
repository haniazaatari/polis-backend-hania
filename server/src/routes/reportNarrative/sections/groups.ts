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

export async function handle_GET_groups({
  rid,
  storage,
  res,
  model,
  system_lore,
  zid,
  modelVersion,
  totalComments,
}: SectionHandlerParams) {
  const section = {
    name: "groups",
    templatePath: "src/report_experimental/subtaskPrompts/groups.xml",
    filter: (v: {
      votes?: number;
      agrees?: number;
      disagrees?: number;
      passes?: number;
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
    logCoverageMetrics(section.name, metrics);

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
