import { Request, Response } from "express";
import logger from "../../utils/logger";
import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getZidFromReport } from "../../utils/parameter";

/**
 * Handler for Delphi API route that retrieves LLM topic names from DynamoDB
 */
export function handle_GET_delphi(req: Request, res: Response) {
  logger.info("Delphi API request received");
  
  // Get report_id from request
  const report_id = req.query.report_id as string;
  
  if (!report_id) {
    return res.json({ 
      status: "error", 
      message: "report_id is required" 
    });
  }

  // Extract zid from report_id - we need this to query DynamoDB
  getZidFromReport(report_id)
    .then(zid => {
      if (!zid) {
        return res.json({
          status: "error",
          message: "Could not find conversation for report_id",
          report_id: report_id
        });
      }

      const conversation_id = zid.toString();
      logger.info(`Fetching Delphi LLM topics for conversation_id: ${conversation_id}`);

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

      // Log connection config for debugging
      logger.info(`DynamoDB Config: 
        Region: ${dynamoDBConfig.region}
        Endpoint: ${dynamoDBConfig.endpoint || "Default AWS endpoint"}
        AWS_ACCESS_KEY_ID: ${process.env.AWS_ACCESS_KEY_ID ? "Set" : "Not set"}
        AWS_SECRET_ACCESS_KEY: ${process.env.AWS_SECRET_ACCESS_KEY ? "Set" : "Not set"}
      `);

      // Create DynamoDB clients
      const client = new DynamoDBClient(dynamoDBConfig);
      const docClient = DynamoDBDocumentClient.from(client, {
        marshallOptions: {
          convertEmptyValues: true,
          removeUndefinedValues: true,
        }
      });

      // Table name for LLM topic names
      const tableName = "Delphi_CommentClustersLLMTopicNames";

      // First, try to list tables to see if our table exists
      try {
        // Create a command to list all tables
        const listTablesCommand = new ListTablesCommand({});
        
        // Log that we're checking tables
        logger.info(`Checking DynamoDB tables...`);
        
        // Execute the command and handle results
        client.send(listTablesCommand)
          .then(tableData => {
            // Make sure TableNames is defined
            const tableNames = tableData.TableNames || [];
            logger.info(`Found ${tableNames.length} DynamoDB tables: ${JSON.stringify(tableNames)}`);
            
            // Check if our table exists
            const tableExists = tableNames.includes(tableName);
            logger.info(`Table ${tableName} exists: ${tableExists}`);
            
            if (!tableExists) {
              // If table doesn't exist, return a helpful message
              // Also provide info on how to create the table
              return res.json({
                status: "success",
                message: `Table ${tableName} not found in DynamoDB.`,
                hint: "The table may need to be created by running the Delphi pipeline",
                report_id: report_id,
                conversation_id: conversation_id,
                available_tables: tableNames,
                topics: {}
              });
            }
            
            // If we get here, the table exists, proceed with query
            proceedWithQuery();
          })
          .catch(err => {
            logger.error(`Error listing DynamoDB tables: ${err.message}`);
            logger.error(`Error type: ${err.name}`);
            if (err.code === "UnrecognizedClientException") {
              logger.error("This error usually indicates an authentication issue with DynamoDB");
              logger.error("Check AWS credentials and region settings");
            } else if (err.name === "NetworkingError") {
              logger.error(`Cannot connect to DynamoDB endpoint: ${dynamoDBConfig.endpoint}`);
              logger.error("Check if the DynamoDB service is running and accessible from the server container");
              logger.error("Consider testing with: curl " + dynamoDBConfig.endpoint);
            }
            
            // If we can't list tables, we should still try the query
            // It might be a permissions issue where we can query but not list
            logger.info("Proceeding with query anyway...");
            proceedWithQuery();
          });
      } catch (err) {
        // Something went wrong with the setup
        const error = err as Error;
        logger.error(`Error setting up table list: ${error.message}`);
        logger.error(`Error stack: ${error.stack}`);
        logger.info("Proceeding with query anyway...");
        proceedWithQuery();
      }
      
      // Function to execute the actual query
      function proceedWithQuery() {
        // Query parameters to get LLM topic names for the conversation
        const params = {
          TableName: tableName,
          KeyConditionExpression: "conversation_id = :cid",
          ExpressionAttributeValues: {
            ":cid": conversation_id
          }
        };
        
        // Log that we're executing the query
        logger.info(`Executing DynamoDB query: ${JSON.stringify(params)}`);

        // Query DynamoDB
        docClient.send(new QueryCommand(params))
        .then(data => {
          // Early return if no items found
          if (!data.Items || data.Items.length === 0) {
            return res.json({
              status: "success",
              message: "No LLM topics found for this conversation",
              report_id: report_id,
              conversation_id: conversation_id,
              topics: {}
            });
          }

          // Process results - organize topics by run, then by layer, then by cluster
          // Group by creation timestamp and model to identify different runs
          const items = data.Items;
          
          // First group by model and creation date (truncate to day for grouping)
          const runGroups: Record<string, any[]> = {};
          
          items.forEach(item => {
            const modelName = item.model_name || 'unknown';
            const createdAt = item.created_at || '';
            const createdDate = createdAt.substring(0, 10); // Take just the date part YYYY-MM-DD
            
            // Create a run key based on model and creation date
            const runKey = `${modelName}_${createdDate}`;
            
            if (!runGroups[runKey]) {
              runGroups[runKey] = [];
            }
            
            runGroups[runKey].push(item);
          });

          // Now organize each run into layers and clusters
          const allRuns: Record<string, any> = {};
          
          Object.entries(runGroups).forEach(([runKey, runItems]) => {
            const topicsByLayer: Record<string, Record<string, any>> = {};
            
            // Process each item in this run
            runItems.forEach(item => {
              const layerId = item.layer_id;
              const clusterId = item.cluster_id;
              
              // Initialize layer if it doesn't exist
              if (!topicsByLayer[layerId]) {
                topicsByLayer[layerId] = {};
              }
              
              // Add topic to its layer
              topicsByLayer[layerId][clusterId] = {
                topic_name: item.topic_name,
                model_name: item.model_name,
                created_at: item.created_at,
                topic_key: item.topic_key
              };
            });
            
            // Get sample data to represent the run
            const sampleItem = runItems[0];
            
            // Add run with metadata
            allRuns[runKey] = {
              model_name: sampleItem.model_name,
              created_date: sampleItem.created_at?.substring(0, 10),
              topics_by_layer: topicsByLayer,
              item_count: runItems.length
            };
          });

          // Return all runs, with the most recent runs first
          const sortedRuns = Object.entries(allRuns)
            .sort(([keyA, runA], [keyB, runB]) => {
              // Sort by created_date in descending order (newest first)
              const dateA = runA.created_date || '';
              const dateB = runB.created_date || '';
              return dateB.localeCompare(dateA);
            })
            .reduce((acc, [key, value]) => {
              acc[key] = value;
              return acc;
            }, {} as Record<string, any>);

          // Return the results
          return res.json({
            status: "success",
            message: "LLM topics retrieved successfully",
            report_id: report_id,
            conversation_id: conversation_id,
            runs: sortedRuns
          });
        })
        .catch(err => {
          // Check if this is a "table not found" error
          if (err.name === "ResourceNotFoundException") {
            logger.warn(`DynamoDB table not found: Delphi_CommentClustersLLMTopicNames`);
            return res.json({
              status: "success",
              message: "Delphi topic service not available yet",
              hint: "The table may need to be created by running the Delphi pipeline",
              report_id: report_id,
              conversation_id: conversation_id,
              topics: {}
            });
          }
          
          // Log detailed error information
          logger.error(`Error querying DynamoDB: ${err.message}`);
          logger.error(`Error type: ${err.name}`);
          logger.error(`Error code: ${err.$metadata?.httpStatusCode}`);
          
          // Format a helpful message based on the error type
          let helpMessage = "";
          
          // Check credentials error
          if (err.name === "CredentialsProviderError") {
            logger.error("AWS credential issue - check environment variables");
            helpMessage = "AWS credential issue - check AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables";
          }
          
          // Check connection error
          if (err.name === "NetworkingError") {
            logger.error(`Network error connecting to DynamoDB endpoint: ${dynamoDBConfig.endpoint || "default"}`);
            helpMessage = `Network error connecting to DynamoDB at ${dynamoDBConfig.endpoint || "default"} - check if DynamoDB service is running and accessible`;
          }
          
          // Check permissions error
          if (err.name === "AccessDeniedException") {
            logger.error("AWS permissions issue - credentials do not have access to this DynamoDB table");
            helpMessage = "AWS permissions issue - credentials do not have access to this DynamoDB table";
          }
          
          // If validation error
          if (err.name === "ValidationException") {
            logger.error(`DynamoDB validation error: ${err.message}`);
            helpMessage = `DynamoDB validation error: ${err.message} - check table schema or partition key`;
          }
          
          // Try to log more details if available
          try {
            logger.error(JSON.stringify(err, null, 2));
          } catch (e) {
            logger.error("Could not stringify error object");
          }
          
          return res.json({
            status: "success", // Use success to avoid frontend errors
            message: "Error querying DynamoDB",
            error: err.message,
            error_type: err.name,
            help: helpMessage,
            report_id: report_id,
            conversation_id: conversation_id,
            topics: {} // Return empty topics to avoid client-side errors
          });
        });
      }
    })
    .catch(err => {
      logger.error(`Error in delphi endpoint: ${err}`);
      return res.json({
        status: "error",
        message: "Error processing request",
        error: err.message,
        report_id: report_id
      });
    });
}