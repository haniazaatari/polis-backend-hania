import { Request, Response } from "express";
import logger from "../../utils/logger";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { getZidFromReport } from "../../utils/parameter";
import Config from "../../config";

/**
 * Handler for Delphi API route that retrieves LLM-generated reports from DynamoDB
 */
export async function handle_GET_delphi_reports(req: Request, res: Response) {
  logger.info("Delphi Reports API request received");
  
  // Get report_id from request
  const report_id = req.query.report_id as string;
  
  if (!report_id) {
    return res.json({ 
      status: "error", 
      message: "report_id is required" 
    });
  }

  // Extract zid from report_id - we need this to query DynamoDB
  try {
    const zid = await getZidFromReport(report_id);
    if (!zid) {
      return res.json({
        status: "error",
        message: "Could not find conversation for report_id",
        report_id: report_id
      });
    }

    const conversation_id = zid.toString();
    logger.info(`Fetching Delphi reports for conversation_id: ${conversation_id}`);

    // Configure DynamoDB based on environment
    const dynamoDBConfig: any = {
      region: Config.AWS_REGION || "us-east-1",
    };

    // If DYNAMODB_ENDPOINT is set, we're using local DynamoDB
    if (Config.dynamoDbEndpoint) {
      dynamoDBConfig.endpoint = Config.dynamoDbEndpoint;
      // For local DynamoDB, use dummy credentials
      dynamoDBConfig.credentials = {
        accessKeyId: "DUMMYIDEXAMPLE",
        secretAccessKey: "DUMMYEXAMPLEKEY",
      };
      logger.info(`Using local DynamoDB at endpoint: ${Config.dynamoDbEndpoint}`);
    } else {
      // For production, use real AWS credentials
      if (Config.AWS_ACCESS_KEY_ID && Config.AWS_SECRET_ACCESS_KEY) {
        dynamoDBConfig.credentials = {
          accessKeyId: Config.AWS_ACCESS_KEY_ID,
          secretAccessKey: Config.AWS_SECRET_ACCESS_KEY,
        };
        logger.info(`Using production DynamoDB with AWS credentials`);
      } else {
        // Let the SDK use default credential provider chain (IAM role, etc.)
        logger.info(`Using default AWS credential provider chain`);
      }
    }

    // Create DynamoDB clients
    const client = new DynamoDBClient(dynamoDBConfig);
    const docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        convertEmptyValues: true,
        removeUndefinedValues: true,
      }
    });

    // Table name for LLM topic names
    const tableName = "Delphi_NarrativeReports";

    // Query parameters to get reports for the conversation
    // Note: Reports are stored with report_id as the prefix, not conversation_id
    const params = {
      TableName: tableName,
      FilterExpression: "begins_with(rid_section_model, :prefix)",
      ExpressionAttributeValues: {
        ":prefix": `${report_id}#`
      }
    };
    
    // Log that we're executing the query
    logger.info(`Executing DynamoDB scan: ${JSON.stringify(params)}`);

    // Scan DynamoDB
    try {
      const data = await docClient.send(new ScanCommand(params));

      // Early return if no items found
      if (!data.Items || data.Items.length === 0) {
        return res.json({
          status: "success",
          message: "No reports found for this conversation",
          report_id: report_id,
          conversation_id: conversation_id,
          reports: {}
        });
      }

      // Process results - organize reports by job_id to identify different runs
      const items = data.Items;
      
      // Group by job_id to identify different runs
      const reportRuns: Record<string, any[]> = {};
      
      items.forEach(item => {
        const job_id = item.job_id;
        
        if (!job_id) {
          logger.error(`Report item missing job_id: ${item.rid_section_model}`);
          return; // Skip this item
        }
        
        if (!reportRuns[job_id]) {
          reportRuns[job_id] = [];
        }
        reportRuns[job_id].push(item);
      });
      
      // Sort runs by timestamp of first item in each run (most recent first)
      const sortedRunKeys = Object.keys(reportRuns).sort((a, b) => {
        const aTime = reportRuns[a][0]?.timestamp || '';
        const bTime = reportRuns[b][0]?.timestamp || '';
        return bTime.localeCompare(aTime);
      });
      const mostRecentRunKey = sortedRunKeys[0];
      const mostRecentItems = reportRuns[mostRecentRunKey] || [];
      
      logger.info(`Found ${Object.keys(reportRuns).length} report runs, using most recent from ${mostRecentRunKey}`);
      
      // Group by section and model for the most recent run
      const reportsBySection: Record<string, any> = {};
      
      mostRecentItems.forEach(item => {
        // New key format: report_id#job_id#section
        // All needed fields are stored as attributes
        const section = item.section;
        const model = item.model || 'unknown';
        const timestamp = item.timestamp || '';
        const report_data = item.report_data || '';
        
        if (!section) {
          logger.error(`Report item missing section: ${item.rid_section_model}`);
          return;
        }
        
        // Add report data
        reportsBySection[section] = {
          section: section,
          model: model,
          timestamp: timestamp,
          report_data: report_data,
          errors: item.errors,
          metadata: item.metadata || null
        };
      });

      // Get info about all runs for potential UI dropdown
      const allRuns = sortedRunKeys.map(runKey => {
        const runItems = reportRuns[runKey];
        const sampleItem = runItems[0];
        return {
          job_id: runKey,
          timestamp: sampleItem.timestamp,
          model: sampleItem.model || 'unknown',
          sectionCount: runItems.length,
          isCurrent: runKey === mostRecentRunKey
        };
      });

      // Return the results
      return res.json({
        status: "success",
        message: "Reports retrieved successfully",
        report_id: report_id,
        conversation_id: conversation_id,
        reports: reportsBySection,
        current_run: mostRecentRunKey,
        available_runs: allRuns
      });
    } catch (err: any) {
      logger.error(`Error querying DynamoDB: ${err.message}`);
      logger.error(JSON.stringify(err, null, 2));
      
      return res.json({
        status: "error",
        message: `Error querying DynamoDB: ${err.message}`,
        report_id: report_id,
        conversation_id: conversation_id,
        reports: {}
      });
    }
  } catch (err: any) {
    logger.error(`Error in delphi reports endpoint: ${err.message}`);
    return res.json({
      status: "error",
      message: "Error processing request",
      error: err.message,
      report_id: report_id
    });
  }
}