import { Request, Response } from "express";
import logger from "../utils/logger";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getZidFromReport } from "../utils/parameter";
import Config from "../config";

const dynamoDBConfig: any = {
  region: Config.AWS_REGION || "us-east-1",
};

if (Config.dynamoDbEndpoint) {
  dynamoDBConfig.endpoint = Config.dynamoDbEndpoint;
  dynamoDBConfig.credentials = {
    accessKeyId: "DUMMYIDEXAMPLE",
    secretAccessKey: "DUMMYEXAMPLEKEY",
  };
} else if (Config.AWS_ACCESS_KEY_ID && Config.AWS_SECRET_ACCESS_KEY) {
  dynamoDBConfig.credentials = {
    accessKeyId: Config.AWS_ACCESS_KEY_ID,
    secretAccessKey: Config.AWS_SECRET_ACCESS_KEY,
  };
}

const client = new DynamoDBClient(dynamoDBConfig);
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    convertEmptyValues: true,
    removeUndefinedValues: true,
  },
});

/**
 * Handler for Delphi API route that retrieves LLM topic names from DynamoDB
 */
export async function handle_GET_delphi(req: Request, res: Response) {
  logger.info("Delphi API request received");

  const report_id = req.query.report_id as string;
  if (!report_id) {
    return res.status(400).json({
      status: "error",
      message: "report_id is required",
    });
  }

  try {
    const zid = await getZidFromReport(report_id);
    if (!zid) {
      return res.status(404).json({
        status: "error",
        message: "Could not find conversation for report_id",
        report_id: report_id,
      });
    }

    const conversation_id = zid.toString();
    const tableName = "Delphi_CommentClustersLLMTopicNames";

    logger.info(
      `Fetching Delphi LLM topics for conversation_id: ${conversation_id}`
    );

    const allItems: any[] = [];
    let lastEvaluatedKey;

    do {
      const params: any = {
        TableName: tableName,
        KeyConditionExpression: "conversation_id = :cid",
        ExpressionAttributeValues: { ":cid": conversation_id },
        ExclusiveStartKey: lastEvaluatedKey,
      };

      const data = await docClient.send(new QueryCommand(params));
      if (data.Items) {
        allItems.push(...data.Items);
      }
      lastEvaluatedKey = data.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    if (allItems.length === 0) {
      return res.json({
        status: "success",
        message: "No LLM topics found for this conversation",
        report_id,
        conversation_id,
        runs: {}, // Return "runs" object for consistency
      });
    }

    const runGroups: Record<string, any[]> = {};
    allItems.forEach((item) => {
      const modelName = item.model_name || "unknown";
      const createdAt = item.created_at || "";
      const createdDate = createdAt.substring(0, 10);
      const runKey = `${modelName}_${createdDate}`;
      if (!runGroups[runKey]) {
        runGroups[runKey] = [];
      }
      runGroups[runKey].push(item);
    });

    const allRuns: Record<string, any> = {};
    Object.entries(runGroups).forEach(([runKey, runItems]) => {
      const topicsByLayer: Record<string, Record<string, any>> = {};
      runItems.forEach((item) => {
        const layerId = item.layer_id;
        const clusterId = item.cluster_id;
        if (!topicsByLayer[layerId]) {
          topicsByLayer[layerId] = {};
        }
        topicsByLayer[layerId][clusterId] = {
          topic_name: item.topic_name,
          model_name: item.model_name,
          created_at: item.created_at,
          topic_key: item.topic_key,
        };
      });
      const sampleItem = runItems[0];
      allRuns[runKey] = {
        model_name: sampleItem.model_name,
        created_date: sampleItem.created_at?.substring(0, 10),
        topics_by_layer: topicsByLayer,
        item_count: runItems.length,
      };
    });

    const sortedRuns = Object.entries(allRuns)
      .sort(([, runA], [, runB]) =>
        (runB.created_date || "").localeCompare(runA.created_date || "")
      )
      .reduce((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {} as Record<string, any>);

    return res.json({
      status: "success",
      message: "LLM topics retrieved successfully",
      report_id,
      conversation_id,
      runs: sortedRuns,
    });
  } catch (err: any) {
    if (err.name === "ResourceNotFoundException") {
      logger.warn(
        `DynamoDB table not found: Delphi_CommentClustersLLMTopicNames`
      );
      return res.status(404).json({
        status: "error",
        message: "Delphi topic service not available yet.",
        hint:
          "The table may need to be created by running the Delphi pipeline.",
        report_id,
      });
    }
    logger.error(
      `Error querying DynamoDB or processing request: ${err.message}`
    );
    logger.error(`Error details: ${JSON.stringify(err)}`);

    return res.status(500).json({
      status: "error",
      message: "Error querying DynamoDB",
      error_details: {
        name: err.name,
        message: err.message,
      },
      report_id,
    });
  }
}
