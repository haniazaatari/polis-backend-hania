import { Request, Response } from "express";
import logger from "../utils/logger";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getZidFromReport } from "../utils/parameter";
import Config from "../config";
import pgQuery from "../db/pg-query";
import * as request from "request-promise";

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

interface TopicMetrics {
  comment_count: number;
  total_votes: number;
  consensus: number;
  divisiveness: number;
  agree_votes: number;
  disagree_votes: number;
  pass_votes: number;
  vote_density: number; // votes per comment
}


/**
 * Calculate consensus and divisiveness metrics for a set of comments
 */
async function calculateTopicMetrics(
  zid: number,
  commentIds: number[]
): Promise<TopicMetrics> {
  if (commentIds.length === 0) {
    return {
      comment_count: 0,
      total_votes: 0,
      consensus: 0,
      divisiveness: 0,
      agree_votes: 0,
      disagree_votes: 0,
      pass_votes: 0,
      vote_density: 0,
    };
  }

  try {
    // Get vote data for these comments
    const voteQuery = `
      SELECT 
        tid,
        COUNT(*) as vote_count,
        SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END) as agree_count,
        SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END) as disagree_count,
        SUM(CASE WHEN vote = 0 THEN 1 ELSE 0 END) as pass_count
      FROM votes_latest_unique
      WHERE zid = $1 AND tid = ANY($2::int[])
      GROUP BY tid
    `;

    const voteResults = await pgQuery.queryP(voteQuery, [zid, commentIds]) as any[];
    
    if (!voteResults || voteResults.length === 0) {
      return {
        comment_count: commentIds.length,
        total_votes: 0,
        consensus: 0,
        divisiveness: 0,
        agree_votes: 0,
        disagree_votes: 0,
        pass_votes: 0,
        vote_density: 0,
      };
    }

    // Calculate aggregate metrics
    let totalVotes = 0;
    let totalAgree = 0;
    let totalDisagree = 0;
    let totalPass = 0;
    let consensusSum = 0;
    let divisiveSum = 0;

    voteResults.forEach((row: any) => {
      const voteCount = parseInt(row.vote_count) || 0;
      const agreeCount = parseInt(row.agree_count) || 0;
      const disagreeCount = parseInt(row.disagree_count) || 0;
      const passCount = parseInt(row.pass_count) || 0;

      totalVotes += voteCount;
      totalAgree += agreeCount;
      totalDisagree += disagreeCount;
      totalPass += passCount;

      // Calculate per-comment consensus (agreement rate among non-pass votes)
      const activeVotes = agreeCount + disagreeCount;
      if (activeVotes > 0) {
        const agreeRate = agreeCount / activeVotes;
        const disagreeRate = disagreeCount / activeVotes;
        const consensus = Math.max(agreeRate, disagreeRate);
        consensusSum += consensus * voteCount; // Weight by vote count

        // Divisiveness: how evenly split the votes are (0 = consensus, 1 = perfectly split)
        const divisiveness = 1 - Math.abs(agreeRate - disagreeRate);
        divisiveSum += divisiveness * voteCount;
      }
    });

    // Calculate weighted averages
    const avgConsensus = totalVotes > 0 ? consensusSum / totalVotes : 0;
    const avgDivisiveness = totalVotes > 0 ? divisiveSum / totalVotes : 0;
    
    // Calculate vote density
    const voteDensity = commentIds.length > 0 ? totalVotes / commentIds.length : 0;
    
    // Topic-based group consensus would go here if we had group membership data
    // For now, we rely on the Delphi group-aware consensus

    return {
      comment_count: commentIds.length,
      total_votes: totalVotes,
      consensus: avgConsensus,
      divisiveness: avgDivisiveness,
      agree_votes: totalAgree,
      disagree_votes: totalDisagree,
      pass_votes: totalPass,
      vote_density: voteDensity,
    };
  } catch (err) {
    logger.error(`Error calculating topic metrics: ${err}`);
    throw err;
  }
}

/**
 * Handler for /api/v3/topicStats endpoint
 */
export async function handle_GET_topicStats(req: Request, res: Response) {
  logger.info("TopicStats API request received");

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
    logger.info(`Fetching topic stats for conversation_id: ${conversation_id}`);

    // Get all topics first
    const topicsTable = "Delphi_CommentClustersLLMTopicNames";
    const topicsParams = {
      TableName: topicsTable,
      KeyConditionExpression: "conversation_id = :cid",
      ExpressionAttributeValues: {
        ":cid": conversation_id,
      },
    };

    const topicsData = await docClient.send(new QueryCommand(topicsParams));
    if (!topicsData.Items || topicsData.Items.length === 0) {
      return res.json({
        status: "success",
        message: "No topics found for this conversation",
        stats: {},
      });
    }

    // Create mapping of layer_cluster to topic
    const clusterToTopic: Record<string, any> = {};
    topicsData.Items.forEach((topic) => {
      const topicKey = topic.topic_key;
      
      // Handle both formats:
      // Old format: 'layer0_5' -> layer=0, cluster=5
      // New format: 'uuid#0#5' -> layer=0, cluster=5
      
      if (topicKey.includes('#')) {
        // New format with job UUID
        const parts = topicKey.split('#');
        if (parts.length >= 3) {
          const layer = parseInt(parts[1]);
          const cluster = parseInt(parts[2]);
          clusterToTopic[`${layer}_${cluster}`] = topic;
        }
      } else if (topicKey.includes('_')) {
        // Old format
        const parts = topicKey.split('_');
        if (parts.length >= 2 && parts[0].startsWith('layer')) {
          const layer = parseInt(parts[0].replace('layer', ''));
          const cluster = parseInt(parts[1]);
          clusterToTopic[`${layer}_${cluster}`] = topic;
        }
      }
    });

    // Query all comment assignments from DynamoDB
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

    if (allAssignments.length === 0) {
      return res.json({
        status: "success",
        message: "No comment assignments found",
        stats: {},
      });
    }

    // Group comments by topic_key
    const commentsByTopic: Record<string, Set<number>> = {};
    
    // Initialize all topics
    topicsData.Items.forEach((topic) => {
      commentsByTopic[topic.topic_key] = new Set<number>();
    });

    // Map comments to topics based on cluster assignments
    allAssignments.forEach((assignment) => {
      const commentId = parseInt(assignment.comment_id);
      
      // Check each layer
      for (let layer = 0; layer < 4; layer++) {
        const clusterId = assignment[`layer${layer}_cluster_id`];
        if (clusterId !== undefined && clusterId !== -1) {
          const topicLookupKey = `${layer}_${clusterId}`;
          const topic = clusterToTopic[topicLookupKey];
          if (topic) {
            commentsByTopic[topic.topic_key].add(commentId);
          }
        }
      }
    });
    
    // Debug: Log mapping results
    logger.info(`Cluster to topic mapping has ${Object.keys(clusterToTopic).length} entries`);
    logger.info(`Found ${allAssignments.length} comment assignments`);
    const nonEmptyTopics = Object.entries(commentsByTopic).filter(([_, comments]) => comments.size > 0);
    logger.info(`Topics with comments: ${nonEmptyTopics.length} out of ${Object.keys(commentsByTopic).length} total topics`);

    // Calculate metrics for each topic
    const topicStats: Record<string, TopicMetrics> = {};
    
    for (const [topicKey, commentIdSet] of Object.entries(commentsByTopic)) {
      const commentIds = Array.from(commentIdSet);
      logger.info(`Calculating metrics for topic ${topicKey} with ${commentIds.length} comments`);
      
      // Debug: log sample comment IDs for first topic
      if (Object.keys(topicStats).length === 0 && commentIds.length > 0) {
        logger.info(`Sample comment IDs for topic ${topicKey}: ${JSON.stringify(commentIds.slice(0, 3))}`);
      }
      
      const metrics = await calculateTopicMetrics(zid, commentIds);
      topicStats[topicKey] = metrics;
    }

    return res.json({
      status: "success",
      message: "Topic statistics retrieved successfully",
      report_id,
      stats: topicStats,
      total_topics: Object.keys(topicStats).length,
    });
  } catch (err: any) {
    logger.error(`Error in handle_GET_topicStats: ${err.message}`);
    logger.error(`Error stack: ${err.stack}`);
    
    return res.status(500).json({
      status: "error",
      message: "Error retrieving topic statistics",
      error_details: {
        name: err.name,
        message: err.message,
      },
      report_id,
    });
  }
}