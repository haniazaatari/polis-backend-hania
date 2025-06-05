import { Request, Response } from "express";
import logger from "../../utils/logger";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getZidFromReport } from "../../utils/parameter";
import Config from "../../config";

const dynamoDBConfig: any = {
  region: Config.AWS_REGION || "us-east-1",
};
if (Config.dynamoDbEndpoint) {
  dynamoDBConfig.endpoint = Config.dynamoDbEndpoint;
  dynamoDBConfig.credentials = {
    accessKeyId: "DUMMYIDEXAMPLE",
    secretAccessKey: "DUMMYEXAMPLEKEY",
  };
  logger.info(`Using local DynamoDB at endpoint: ${Config.dynamoDbEndpoint}`);
} else {
  if (Config.AWS_ACCESS_KEY_ID && Config.AWS_SECRET_ACCESS_KEY) {
    dynamoDBConfig.credentials = {
      accessKeyId: Config.AWS_ACCESS_KEY_ID,
      secretAccessKey: Config.AWS_SECRET_ACCESS_KEY,
    };
    logger.info(`Using production DynamoDB with AWS credentials`);
  } else {
    logger.info(`Using default AWS credential provider chain`);
  }
}
const client = new DynamoDBClient(dynamoDBConfig);
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    convertEmptyValues: true,
    removeUndefinedValues: true,
  },
});

/**
 * Handler for Delphi API route that retrieves LLM-generated reports from DynamoDB
 */
export async function handle_GET_delphi_reports(req: Request, res: Response) {
  logger.info("Delphi Reports API request received");

  const requestReportId = req.query.report_id as string;
  const sectionFilter = req.query.section as string;
  const topicKeyFilter = req.query.topic_key as string;

  if (!requestReportId) {
    return res.json({
      status: "error",
      message: "report_id (requestReportId) is required",
    });
  }

  let gsiQueryableReportId: string;

  try {
    const zid = await getZidFromReport(requestReportId);
    if (zid === null || zid === undefined) {
      logger.error(
        `Could not resolve requestReportId '${requestReportId}' to a ZID/GSI-report_id.`
      );
      return res.json({
        status: "error",
        message:
          "Could not find a valid identifier for the report_id to query DynamoDB.",
        request_report_id: requestReportId,
      });
    }
    gsiQueryableReportId = zid.toString();
    logger.info(
      `Fetching Delphi reports for GSI report_id: ${gsiQueryableReportId} (derived from requestReportId: ${requestReportId})`
    );
  } catch (err: any) {
    logger.error(
      `Error resolving requestReportId '${requestReportId}' via getZidFromReport: ${err.message}`
    );
    return res.json({
      status: "error",
      message: "Error resolving report identifier.",
      request_report_id: requestReportId,
      error_details: err.message,
    });
  }

  const tableName = "Delphi_NarrativeReports";
  const gsiName = "ReportIdTimestampIndex";

  try {
    logger.info(
      `Querying GSI '${gsiName}' on table '${tableName}' for GSI report_id: '${gsiQueryableReportId}'`
    );
    const allItems: any[] = [];
    let lastEvaluatedKeyGSI;
    do {
      const queryParams: any = {
        TableName: tableName,
        IndexName: gsiName,
        KeyConditionExpression: "report_id = :gsi_rid",
        ExpressionAttributeValues: { ":gsi_rid": gsiQueryableReportId },
        ExclusiveStartKey: lastEvaluatedKeyGSI,
      };
      const queryResult = await docClient.send(new QueryCommand(queryParams));
      if (queryResult.Items) {
        allItems.push(...queryResult.Items);
      }
      lastEvaluatedKeyGSI = queryResult.LastEvaluatedKey;
    } while (lastEvaluatedKeyGSI);

    logger.info(
      `GSI Query found ${allItems.length} total items for GSI report_id: '${gsiQueryableReportId}'`
    );

    if (allItems.length === 0) {
      return res.json({
        status: "success",
        message: "No reports found for the given report identifier.",
        request_report_id: requestReportId,
        queried_gsi_report_id: gsiQueryableReportId,
        reports: {},
      });
    }

    // --- Processing Logic ---
    const reportRuns: Record<string, any[]> = {};
    allItems.forEach((item) => {
      const timestamp = item.timestamp || "";
      const runKey = timestamp.substring(0, 16);
      if (!reportRuns[runKey]) {
        reportRuns[runKey] = [];
      }
      reportRuns[runKey].push(item);
    });

    const sortedRunKeys = Object.keys(reportRuns).sort((a, b) =>
      b.localeCompare(a)
    );
    if (sortedRunKeys.length === 0) {
      return res.json({
        status: "success",
        message: "No report runs found after grouping.",
        request_report_id: requestReportId,
        queried_gsi_report_id: gsiQueryableReportId,
        reports: {},
      });
    }
    const mostRecentRunKey = sortedRunKeys[0];
    const mostRecentItems = reportRuns[mostRecentRunKey] || [];
    logger.info(
      `Found ${
        Object.keys(reportRuns).length
      } report runs, using most recent from ${mostRecentRunKey}`
    );

    const reportsBySection: Record<string, any> = {};
    mostRecentItems.forEach((item) => {
      const rid_section_model = item.rid_section_model || "";
      const parts = rid_section_model.split("#");
      if (parts.length >= 2) {
        const section = parts[1];
        const model = parts.length > 2 ? parts[2] : "unknown";
        // This populates reportsBySection where each key is a section name,
        // and the value is the report object for that section from the most recent run.
        reportsBySection[section] = {
          section: section,
          model: model,
          timestamp: item.timestamp || "",
          report_data: item.report_data || "",
          errors: item.errors,
          metadata: item.metadata || null,
        };
      }
    });

    const allRuns = sortedRunKeys.map((runKey) => {
      const runItems = reportRuns[runKey];
      const sampleItem = runItems.length > 0 ? runItems[0] : {};
      const rid_section_model_parts = sampleItem.rid_section_model?.split("#");
      const modelFromSample =
        rid_section_model_parts && rid_section_model_parts.length > 2
          ? rid_section_model_parts[2]
          : "unknown";
      return {
        timestamp: runKey,
        model: modelFromSample,
        sectionCount: runItems.length,
        isCurrent: runKey === mostRecentRunKey,
      };
    });

    // --- Filtering logic ---
    let filteredReports = reportsBySection;

    if (sectionFilter && topicKeyFilter) {
      // Attempt to access reportsBySection[sectionFilter][topicKeyFilter]
      if (
        reportsBySection[sectionFilter] &&
        reportsBySection[sectionFilter][topicKeyFilter]
      ) {
        return res.json({
          status: "success",
          message: "Topic report retrieved successfully",
          request_report_id: requestReportId,
          queried_gsi_report_id: gsiQueryableReportId,
          section: sectionFilter,
          topic_key: topicKeyFilter,
          data: reportsBySection[sectionFilter][topicKeyFilter],
        });
      } else {
        return res.json({
          status: "error",
          message: "Topic report not found",
          request_report_id: requestReportId,
          queried_gsi_report_id: gsiQueryableReportId,
          section: sectionFilter,
          topic_key: topicKeyFilter,
        });
      }
    } else if (sectionFilter) {
      filteredReports = {
        [sectionFilter]: reportsBySection[sectionFilter] || {},
      };
    }

    return res.json({
      status: "success",
      message: "Reports retrieved successfully",
      request_report_id: requestReportId,
      queried_gsi_report_id: gsiQueryableReportId,
      reports: filteredReports,
      current_run: mostRecentRunKey,
      available_runs: allRuns,
    });
  } catch (err: any) {
    logger.error(
      `Error during DynamoDB operation or report processing: ${err.message}`
    );
    if (err.stack) {
      logger.error(err.stack);
    }
    return res.json({
      status: "error",
      message: `Error processing request: ${err.message}`,
      request_report_id: requestReportId,
      queried_gsi_report_id: gsiQueryableReportId,
      reports: {},
    });
  }
}
