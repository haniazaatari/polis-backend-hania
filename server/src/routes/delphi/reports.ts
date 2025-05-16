import { Request, Response } from "express";
import logger from "../../utils/logger";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { getZidFromReport } from "../../utils/parameter";

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

    // Force using local DynamoDB by hardcoding the endpoint
    const dynamoDBConfig: any = {
      region: process.env.AWS_REGION || "us-east-1",
      // Force to use the local DynamoDB endpoint
      endpoint: "http://dynamodb:8000"
    };
    
    // Log what we're using
    logger.info(`Forcing local DynamoDB connection:
      Endpoint: ${dynamoDBConfig.endpoint}
      Region: ${dynamoDBConfig.region}`);
    
    // For local DynamoDB, use dummy credentials
    dynamoDBConfig.credentials = {
      accessKeyId: 'DUMMYIDEXAMPLE',
      secretAccessKey: 'DUMMYEXAMPLEKEY'
    };

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
    const params = {
      TableName: tableName,
      FilterExpression: "begins_with(rid_section_model, :prefix)",
      ExpressionAttributeValues: {
        ":prefix": `${conversation_id}#`
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

      // Process results - organize reports by section and model
      const items = data.Items;
      
      // Group by section and model
      const reportsBySection: Record<string, any> = {};
      
      items.forEach(item => {
        const rid_section_model = item.rid_section_model || '';
        const parts = rid_section_model.split('#');
        
        if (parts.length >= 2) {
          const section = parts[1];
          const model = parts[2] || 'unknown';
          const timestamp = item.timestamp || '';
          const report_data = item.report_data || '';
          
          // Initialize section if it doesn't exist
          if (!reportsBySection[section]) {
            reportsBySection[section] = {};
          }
          
          // Add report data
          reportsBySection[section] = {
            section: section,
            model: model,
            timestamp: timestamp,
            report_data: report_data,
            errors: item.errors
          };
        }
      });

      // Return the results
      return res.json({
        status: "success",
        message: "Reports retrieved successfully",
        report_id: report_id,
        conversation_id: conversation_id,
        reports: reportsBySection
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