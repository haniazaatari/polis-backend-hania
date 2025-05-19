import { Request, Response } from "express";
import logger from "../../utils/logger";
import { getZidFromReport } from "../../utils/parameter";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import Config from "../../config";

/**
 * Handler for Delphi API route that retrieves visualization information
 */
export async function handle_GET_delphi_visualizations(
  req: Request,
  res: Response
) {
  logger.info("Delphi visualizations API request received");

  try {
    // Get report_id from request
    const report_id = req.query.report_id as string;
    const jobId = req.query.job_id as string;

    if (!report_id) {
      return res.json({
        status: "error",
        message: "report_id is required",
      });
    }

    // Extract zid from report_id
    let zid;
    try {
      zid = await getZidFromReport(report_id);
    } catch (err: any) {
      logger.error(`Error getting zid from report: ${err.message || err}`);
      return res.json({
        status: "error",
        message: "Could not find conversation for report_id",
        report_id,
      });
    }

    if (!zid) {
      return res.json({
        status: "error",
        message: "Could not find conversation for report_id",
        report_id,
      });
    }

    const conversation_id = zid.toString();
    logger.info(
      `Fetching visualizations for report_id: ${report_id}, conversation_id: ${conversation_id}`
    );

    // Configure S3 client
    const s3Config: any = {
      region: Config.AWS_REGION || "us-east-1",
      endpoint: Config.AWS_S3_ENDPOINT || "http://minio:9000",
      credentials: {
        accessKeyId: Config.AWS_S3_ACCESS_KEY_ID || "minioadmin",
        secretAccessKey: Config.AWS_S3_SECRET_ACCESS_KEY || "minioadmin",
      },
      forcePathStyle: true, // Required for MinIO
    };

    // Log S3 connection info
    logger.info(`S3 Config: 
      Endpoint: ${s3Config.endpoint}
      Region: ${s3Config.region}
      Bucket: ${Config.AWS_S3_BUCKET_NAME || "polis-delphi"}
    `);

    // Create S3 client
    let s3Client;
    try {
      s3Client = new S3Client(s3Config);
    } catch (err: any) {
      logger.error(`Error creating S3 client: ${err.message || err}`);
      return res.json({
        status: "error",
        message: "Failed to initialize S3 client",
        error: err.message || String(err),
        report_id,
      });
    }

    const bucketName = Config.AWS_S3_BUCKET_NAME || "polis-delphi";

    // Define S3 path prefix to search
    // Use conversation_id instead of report_id since files are stored by conversation_id
    const prefix = jobId
      ? `visualizations/${conversation_id}/${jobId}/`
      : `visualizations/${conversation_id}/`;

    // Get job metadata from DynamoDB if available
    let jobMetadata: Record<string, any> = {};
    try {
      jobMetadata = await fetchJobMetadata(report_id, conversation_id);
    } catch (err: any) {
      logger.error(`Error fetching job metadata: ${err.message || err}`);
      // Continue without job metadata
    }

    // List objects in the bucket
    let s3Response;
    try {
      const listObjectsParams = {
        Bucket: bucketName,
        Prefix: prefix,
        MaxKeys: 1000, // Increase if you expect more than 1000 objects
      };

      // Enhanced logging for debugging
      logger.info(
        `Listing S3 objects with params: ${JSON.stringify(listObjectsParams)}`
      );

      try {
        s3Response = await s3Client.send(
          new ListObjectsV2Command(listObjectsParams)
        );

        // Log successful response
        logger.info(
          `S3 listing successful. Found ${
            s3Response.Contents?.length || 0
          } objects.`
        );
        if (s3Response.Contents && s3Response.Contents.length > 0) {
          // Log first few keys for debugging
          const keys = s3Response.Contents.slice(0, 3).map(obj => obj.Key);
          logger.info(`Sample object keys: ${JSON.stringify(keys)}`);
        }
      } catch (s3Error: any) {
        // Log detailed S3 error
        logger.error(`S3 listing error: ${s3Error.message || s3Error}`);
        logger.error(`Error name: ${s3Error.name}, code: ${s3Error.code}`);
        throw s3Error;
      }
    } catch (err: any) {
      logger.error(`Error listing S3 objects: ${err.message || err}`);
      return res.json({
        status: "error",
        message: "Error listing visualizations",
        error: err.message || String(err),
        report_id,
        conversation_id,
      });
    }

    // Check if files were found
    if (!s3Response.Contents || s3Response.Contents.length === 0) {
      return res.json({
        status: "success",
        message: "No visualizations found",
        report_id,
        conversation_id,
        visualizations: [],
        jobs: jobMetadata,
      });
    }

    // Group visualizations by job
    const visualizationsByJob: Record<string, any[]> = {};

    // Process each object
    for (const obj of s3Response.Contents) {
      const key = obj.Key || "";

      // Parse job ID from the key
      // Expected format: visualizations/{report_id}/{job_id}/layer_{layer_id}_datamapplot.html
      const keyParts = key.split("/");

      if (keyParts.length < 4) continue; // Skip if doesn't match expected format

      const currentJobId = keyParts[2];
      const fileName = keyParts[3];

      // Skip if not an HTML file
      if (
        !fileName.endsWith(".html") &&
        !fileName.endsWith(".png") &&
        !fileName.endsWith(".svg")
      ) {
        continue;
      }

      // Parse layer ID
      const layerMatch = fileName.match(/layer_(\d+)/);
      const layerId = layerMatch ? parseInt(layerMatch[1]) : null;

      if (layerId === null) continue; // Skip if can't determine layer

      // Generate a signed URL for this object
      let url;
      try {
        const getObjectParams = {
          Bucket: bucketName,
          Key: key,
        };

        // Instead of using presigned URLs that don't work across network boundaries,
        // just return a direct URL to the object that can be accessed from the browser
        url = `http://localhost:9000/${bucketName}/${key}`;
      } catch (err: any) {
        logger.error(
          `Error generating signed URL for ${key}: ${err.message || err}`
        );
        continue; // Skip this file and continue
      }

      // Determine visualization type
      let type = "unknown";
      if (fileName.includes("datamapplot.html")) {
        type = "interactive";
      } else if (fileName.includes("static.png")) {
        type = "static_png";
      } else if (fileName.includes("presentation.png")) {
        type = "presentation_png";
      } else if (fileName.includes("static.svg")) {
        type = "static_svg";
      }

      // Initialize job array if needed
      if (!visualizationsByJob[currentJobId]) {
        visualizationsByJob[currentJobId] = [];
      }

      // Add to the job's visualizations
      visualizationsByJob[currentJobId].push({
        key,
        url,
        layerId,
        type,
        lastModified: obj.LastModified,
        size: obj.Size,
      });
    }

    // Sort visualizations by layer ID
    Object.values(visualizationsByJob).forEach((visArray) => {
      visArray.sort((a, b) => (a.layerId || 0) - (b.layerId || 0));
    });

    // Combine job metadata with visualizations
    const jobsWithVisualizations = Object.keys(visualizationsByJob).map(
      (jobId) => {
        const jobInfo = jobMetadata[jobId] || {
          jobId,
          status: "unknown",
          createdAt: null,
        };

        return {
          ...jobInfo,
          visualizations: visualizationsByJob[jobId],
        };
      }
    );

    // Sort jobs by createdAt (newest first)
    jobsWithVisualizations.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });

    // Return the results
    return res.json({
      status: "success",
      message: "Visualizations retrieved successfully",
      report_id,
      conversation_id,
      jobs: jobsWithVisualizations,
    });
  } catch (err: any) {
    logger.error(`Error in delphi visualizations endpoint: ${err.message}`);
    logger.error(err.stack);
    return res.json({
      status: "error",
      message: "Error processing request",
      error: err.message,
      report_id: req.query.report_id as string,
    });
  }
}

/**
 * Fetch job metadata from DynamoDB
 */
async function fetchJobMetadata(
  report_id: string,
  conversation_id: string
): Promise<Record<string, any>> {
  try {
    // Configure DynamoDB client
    const dynamoDBConfig: any = {
      region: Config.AWS_REGION || "us-east-1",
      credentials: {
        accessKeyId: "DUMMYIDEXAMPLE",
        secretAccessKey: "DUMMYEXAMPLEKEY",
      },
    };

    // Create DynamoDB clients
    const client = new DynamoDBClient(dynamoDBConfig);
    const docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        convertEmptyValues: true,
        removeUndefinedValues: true,
      },
    });

    // Scan for jobs by conversation ID (using scan instead of query since the index may not exist)
    // This is less efficient but works without requiring a secondary index
    const scanParams = {
      TableName: "Delphi_JobQueue",
      FilterExpression: "conversation_id = :cid",
      ExpressionAttributeValues: {
        ":cid": conversation_id,
      },
    };

    try {
      logger.info(`Scanning for jobs with conversation_id: ${conversation_id}`);
      const scanResponse = await docClient.send(new ScanCommand(scanParams));

      if (!scanResponse.Items || scanResponse.Items.length === 0) {
        logger.info(`No jobs found for conversation ${conversation_id}`);
        return {};
      }

      // Process jobs from scan
      return processJobItems(scanResponse.Items);
    } catch (err: any) {
      logger.error(`Error fetching job metadata: ${err.message}`);
      return {};
    }
  } catch (err: any) {
    logger.error(`Error setting up DynamoDB: ${err.message}`);
    return {};
  }
}

/**
 * Process job items from DynamoDB into a map of job metadata
 */
function processJobItems(items: any[]): Record<string, any> {
  const jobMap: Record<string, any> = {};

  for (const item of items) {
    const job_id = item.job_id;

    jobMap[job_id] = {
      jobId: job_id,
      status: item.status || "unknown",
      createdAt: item.created_at || null,
      startedAt: item.started_at || null,
      completedAt: item.completed_at || null,
      results: item.job_results ? JSON.parse(item.job_results) : null,
    };
  }

  return jobMap;
}
