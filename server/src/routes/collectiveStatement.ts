import { Request, Response } from "express";
import logger from "../utils/logger";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getZidFromReport } from "../utils/parameter";
import Config from "../config";
import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuidv4 } from "uuid";
import pgQuery from "../db/pg-query";

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

const anthropic = Config.anthropicApiKey
  ? new Anthropic({
      apiKey: Config.anthropicApiKey,
    })
  : null;

/**
 * Generate a collective statement for a topic using Claude
 */
async function generateCollectiveStatement(
  zid: number,
  topicKey: string,
  topicName: string,
  commentsData: any
): Promise<any> {
  if (!anthropic) {
    throw new Error("Anthropic API key not configured");
  }

  // Format comments data for the XML prompt
  const formattedComments = commentsData.map((comment: any) => ({
    id: comment.comment_id,
    text: comment.comment_text,
    agrees: comment.agrees || 0,
    disagrees: comment.disagrees || 0,
    passes: comment.passes || 0,
    total_votes: comment.total_votes || 0,
  }));

  // Build the XML prompt
  const systemPrompt = `You are a professional facilitator helping diverse groups find common ground and shared understanding. You will analyze voting patterns and comments to create collective statements that all participants might agree with.`;

  const userPrompt = `<task>
Write a collective statement for a topic where participants have shown consensus. The statement should be written in first person plural ("We believe...", "We agree that...", "We recognize...") and capture areas of agreement.
</task>

<topic>
${topicName}
</topic>

<data>
${JSON.stringify(formattedComments, null, 2)}
</data>

<instructions>
- Focus on comments with high agreement rates (more agrees than disagrees)
- Write 2-3 paragraphs that synthesize the consensus views
- Each claim must be supported by specific comment citations
- Be inclusive of different perspectives while highlighting common ground
- Keep the tone constructive and forward-looking
</instructions>

<responseFormat>
<condensedJSONSchema>
{
  "id": "collective_statement",
  "title": "Collective Statement: ${topicName}",
  "paragraphs": [
    {
      "id": "string", // e.g. "shared_values"
      "title": "string", // e.g. "Our Shared Values"
      "sentences": [
        {
          "clauses": [
            {
              "text": "string", // The actual text content
              "citations": [123] // Required: ID of the comment
            }
          ]
        }
      ]
    }
  ]
}
</condensedJSONSchema>
</responseFormat>

You MUST respond with valid JSON that follows the exact schema above. Each clause must have at least one citation.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-20250514",
      max_tokens: 3000,
      temperature: 0.7,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
        {
          role: "assistant",
          content: "{",
        },
      ],
    });

    // Parse the JSON response
    const responseText = "{" + (response.content[0].type === 'text' ? response.content[0].text : '');
    
    try {
      const statementData = JSON.parse(responseText);
      
      // Return both the structured data and the original comments for citation display
      return {
        statementData,
        commentsData: formattedComments,
      };
    } catch (parseError) {
      logger.error(`Error parsing Claude response: ${parseError}`);
      logger.error(`Response text: ${responseText.substring(0, 500)}...`);
      
      // Fallback: If JSON parsing fails, return a simple text response
      return {
        statementData: {
          id: "collective_statement",
          title: `Collective Statement: ${topicName}`,
          paragraphs: [{
            id: "fallback",
            title: "Generated Statement",
            sentences: [{
              clauses: [{
                text: responseText,
                citations: []
              }]
            }]
          }]
        },
        commentsData: formattedComments,
      };
    }
  } catch (error) {
    logger.error(`Error generating collective statement: ${error}`);
    throw error;
  }
}

/**
 * Handler for POST /api/v3/collectiveStatement
 */
export async function handle_POST_collectiveStatement(req: Request, res: Response) {
  logger.info("CollectiveStatement API request received");

  const { report_id, topic_key, topic_name } = req.body;
  
  if (!report_id || !topic_key || !topic_name) {
    return res.status(400).json({
      status: "error",
      message: "report_id, topic_key, and topic_name are required",
    });
  }

  try {
    const zid = await getZidFromReport(report_id);
    if (!zid) {
      return res.status(404).json({
        status: "error",
        message: "Could not find conversation for report_id",
      });
    }

    // Generate unique key for this statement
    const statementKey = `${zid}#${topic_key}#${uuidv4()}`;
    
    // Get comments for this topic with voting data
    const topicComments = await getCommentsForTopic(zid, topic_key);
    
    logger.info(`Found ${topicComments.length} comments for topic ${topic_key}`);
    
    if (topicComments.length === 0) {
      return res.json({
        status: "error",
        message: "No comments found for this topic",
      });
    }
    
    // Generate the collective statement
    const result = await generateCollectiveStatement(
      zid,
      topic_key,
      topic_name,
      topicComments
    );

    // Store in DynamoDB
    const item = {
      zid_topic_jobid: statementKey,
      zid: zid.toString(),
      topic_key: topic_key,
      topic_name: topic_name,
      statement_data: JSON.stringify(result.statementData),
      comments_data: JSON.stringify(result.commentsData),
      created_at: new Date().toISOString(),
      model: "claude-opus-4-20250514",
    };

    await docClient.send(new PutCommand({
      TableName: "Delphi_CollectiveStatement",
      Item: item,
    }));

    return res.json({
      status: "success",
      statementData: result.statementData,
      commentsData: result.commentsData,
      id: statementKey,
    });

  } catch (err: any) {
    logger.error(`Error in handle_POST_collectiveStatement: ${err.message}`);
    logger.error(`Error stack: ${err.stack}`);
    
    return res.status(500).json({
      status: "error",
      message: "Error generating collective statement",
      error: err.message,
    });
  }
}

/**
 * Handler for GET /api/v3/collectiveStatement
 */
export async function handle_GET_collectiveStatement(req: Request, res: Response) {
  const { statement_id } = req.query;
  
  if (!statement_id) {
    return res.status(400).json({
      status: "error",
      message: "statement_id is required",
    });
  }

  try {
    const result = await docClient.send(new GetCommand({
      TableName: "Delphi_CollectiveStatement",
      Key: {
        zid_topic_jobid: statement_id as string,
      },
    }));

    if (!result.Item) {
      return res.status(404).json({
        status: "error",
        message: "Statement not found",
      });
    }

    return res.json({
      status: "success",
      statement: result.Item,
    });

  } catch (err: any) {
    logger.error(`Error in handle_GET_collectiveStatement: ${err.message}`);
    
    return res.status(500).json({
      status: "error",
      message: "Error retrieving collective statement",
      error: err.message,
    });
  }
}

// Helper function to get comments for a specific topic
async function getCommentsForTopic(zid: number, topicKey: string): Promise<any[]> {
  try {
    // First, get comment IDs assigned to this topic from DynamoDB
    const conversation_id = zid.toString();
    
    // Parse topic key to get layer and cluster
    let layer: number, cluster: number;
    
    if (topicKey.includes('#')) {
      // New format: uuid#layer#cluster
      const parts = topicKey.split('#');
      if (parts.length >= 3) {
        layer = parseInt(parts[1]);
        cluster = parseInt(parts[2]);
      } else {
        throw new Error(`Invalid topic key format: ${topicKey}`);
      }
    } else if (topicKey.includes('_')) {
      // Old format: layer0_5
      const parts = topicKey.split('_');
      if (parts.length >= 2 && parts[0].startsWith('layer')) {
        layer = parseInt(parts[0].replace('layer', ''));
        cluster = parseInt(parts[1]);
      } else {
        throw new Error(`Invalid topic key format: ${topicKey}`);
      }
    } else {
      throw new Error(`Invalid topic key format: ${topicKey}`);
    }

    // Query DynamoDB for comment assignments
    const assignmentsParams = {
      TableName: "Delphi_CommentHierarchicalClusterAssignments",
      KeyConditionExpression: "conversation_id = :cid",
      ExpressionAttributeValues: {
        ":cid": conversation_id,
      },
    };

    const allAssignments: any[] = [];
    let lastEvaluatedKey;

    do {
      const params: any = {
        ...assignmentsParams,
        ExclusiveStartKey: lastEvaluatedKey,
      };

      const data = await docClient.send(new QueryCommand(params));
      if (data.Items) {
        allAssignments.push(...data.Items);
      }
      lastEvaluatedKey = data.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    // Log first assignment to see structure
    if (allAssignments.length > 0) {
      logger.info(`Sample assignment structure: ${JSON.stringify(allAssignments[0])}`);
    }
    
    // Filter comments for this specific topic
    const commentIds: number[] = [];
    allAssignments.forEach((assignment) => {
      const clusterId = assignment[`layer${layer}_cluster_id`];
      // Convert to number for comparison since cluster is a number
      if (clusterId !== undefined && parseInt(clusterId) === cluster) {
        commentIds.push(parseInt(assignment.comment_id));
      }
    });
    
    logger.info(`Topic ${topicKey} - Layer: ${layer}, Cluster: ${cluster}, Found ${commentIds.length} comment assignments`);

    if (commentIds.length === 0) {
      return [];
    }

    // Get full comment data with voting information
    const commentsQuery = `
      SELECT 
        c.tid as comment_id,
        c.txt as comment_text,
        COUNT(DISTINCT v.pid) as total_votes,
        SUM(CASE WHEN v.vote = 1 THEN 1 ELSE 0 END) as agrees,
        SUM(CASE WHEN v.vote = -1 THEN 1 ELSE 0 END) as disagrees,
        SUM(CASE WHEN v.vote = 0 THEN 1 ELSE 0 END) as passes
      FROM comments c
      LEFT JOIN votes_latest_unique v ON c.tid = v.tid AND c.zid = v.zid
      WHERE c.zid = $1 AND c.tid = ANY($2::int[])
      GROUP BY c.tid, c.txt
      ORDER BY total_votes DESC
    `;

    const commentsData = await pgQuery.queryP(commentsQuery, [zid, commentIds]) as any[];
    
    // Return comments with basic voting data
    // Group-level analysis would require participant_group_associations table which doesn't exist yet
    return commentsData;
  } catch (error) {
    logger.error(`Error getting comments for topic: ${error}`);
    throw error;
  }
}