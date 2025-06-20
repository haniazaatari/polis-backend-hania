import { Request, Response } from "express";
import logger from "../../utils/logger";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import Config from "../../config";
import { queryP as pgQueryP } from "../../db/pg-query";
import Conversation from "../../conversation";

// DynamoDB configuration (reuse from topics.ts)
const dynamoDBConfig: any = {
  region: Config.AWS_REGION || "us-east-1",
};

if (Config.dynamoDbEndpoint) {
  dynamoDBConfig.endpoint = Config.dynamoDbEndpoint;
  dynamoDBConfig.credentials = {
    accessKeyId: "DUMMYIDEXAMPLE",
    secretAccessKey: "DUMMYEXAMPLEKEY",
  };
} else {
  if (Config.AWS_ACCESS_KEY_ID && Config.AWS_SECRET_ACCESS_KEY) {
    dynamoDBConfig.credentials = {
      accessKeyId: Config.AWS_ACCESS_KEY_ID,
      secretAccessKey: Config.AWS_SECRET_ACCESS_KEY,
    };
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
 * GET /api/v3/topicMod/topics
 * Retrieves topics with moderation status
 */
export async function handle_GET_topicMod_topics(req: Request, res: Response) {
  try {
    const conversation_id = req.query.conversation_id as string;
    const job_id = req.query.job_id as string;
    
    if (!conversation_id) {
      return res.json({
        status: "error",
        message: "conversation_id is required",
      });
    }

    // Get zid from conversation_id (which could be a zinvite)
    const zid = await Conversation.getZidFromConversationId(conversation_id);
    if (!zid) {
      return res.json({
        status: "error",
        message: "Could not find conversation for conversation_id",
      });
    }

    const conversation_zid = zid.toString();
    logger.info(`Fetching TopicMod topics for zid: ${conversation_zid}`);

    // Query topics from existing table
    const topicsParams = {
      TableName: "Delphi_CommentClustersLLMTopicNames",
      KeyConditionExpression: "conversation_id = :cid",
      ExpressionAttributeValues: {
        ":cid": conversation_zid,
      },
    };

    // Filter by job_id if provided
    if (job_id) {
      topicsParams.KeyConditionExpression += " AND begins_with(topic_key, :job_id)";
      topicsParams.ExpressionAttributeValues[":job_id"] = `${job_id}#`;
    }

    const topicsData = await docClient.send(new QueryCommand(topicsParams));
    
    if (!topicsData.Items || topicsData.Items.length === 0) {
      return res.json({
        status: "success",
        message: "No topics found for this conversation",
        topics: [],
      });
    }

    // Query moderation status for each topic
    const moderationParams = {
      TableName: "Delphi_TopicModerationStatus",
      KeyConditionExpression: "conversation_id = :cid",
      ExpressionAttributeValues: {
        ":cid": conversation_zid,
      },
    };

    let moderationData;
    try {
      moderationData = await docClient.send(new QueryCommand(moderationParams));
    } catch (err: any) {
      // Moderation table might not exist yet - that's okay
      logger.info("Moderation status table not found, using default status");
      moderationData = { Items: [] };
    }

    // Create moderation status map
    const moderationMap = new Map();
    moderationData.Items?.forEach((item) => {
      moderationMap.set(item.topic_key, {
        status: item.moderation_status,
        moderator: item.moderator,
        moderated_at: item.moderated_at,
        comment_count: item.comment_count || 0,
      });
    });

    // Combine topics with moderation status
    const topicsWithStatus = topicsData.Items.map((topic) => {
      const moderation = moderationMap.get(topic.topic_key) || {
        status: "pending",
        moderator: null,
        moderated_at: null,
        comment_count: 0,
      };

      return {
        topic_name: topic.topic_name,
        model_name: topic.model_name,
        created_at: topic.created_at,
        topic_key: topic.topic_key,
        layer_id: topic.layer_id,
        cluster_id: topic.cluster_id,
        moderation: moderation,
      };
    });

    // Group by layer for hierarchical display
    const topicsByLayer: Record<string, any[]> = {};
    topicsWithStatus.forEach((topic) => {
      const layerId = topic.layer_id || "0";
      if (!topicsByLayer[layerId]) {
        topicsByLayer[layerId] = [];
      }
      topicsByLayer[layerId].push(topic);
    });

    // Sort topics within each layer by cluster_id
    Object.keys(topicsByLayer).forEach((layerId) => {
      topicsByLayer[layerId].sort((a, b) => {
        return parseInt(a.cluster_id || "0") - parseInt(b.cluster_id || "0");
      });
    });

    return res.json({
      status: "success",
      message: "Topics retrieved successfully",
      topics_by_layer: topicsByLayer,
      total_topics: topicsWithStatus.length,
    });
  } catch (err: any) {
    logger.error(`Error in handle_GET_topicMod_topics: ${err.message}`);
    return res.json({
      status: "error",
      message: "Error retrieving topics",
      error: err.message,
    });
  }
}

/**
 * GET /api/v3/topicMod/topics/:topicKey/comments
 * Retrieves comments for a specific topic
 */
export async function handle_GET_topicMod_comments(req: Request, res: Response) {
  try {
    const conversation_id = req.query.conversation_id as string;
    const topic_key = req.params.topicKey;
    
    if (!conversation_id || !topic_key) {
      return res.json({
        status: "error",
        message: "conversation_id and topic_key are required",
      });
    }

    const zid = await Conversation.getZidFromConversationId(conversation_id);
    if (!zid) {
      return res.json({
        status: "error",
        message: "Could not find conversation for conversation_id",
      });
    }

    const comment_conversation_id = zid.toString();
    logger.info(`Fetching comments for topic ${topic_key} in conversation ${comment_conversation_id}`);

    // Query comments from topic clusters table
    const params = {
      TableName: "Delphi_CommentClusters",
      KeyConditionExpression: "conversation_id = :cid AND topic_key = :tk",
      ExpressionAttributeValues: {
        ":cid": comment_conversation_id,
        ":tk": topic_key,
      },
    };

    const data = await docClient.send(new QueryCommand(params));
    
    if (!data.Items || data.Items.length === 0) {
      return res.json({
        status: "success",
        message: "No comments found for this topic",
        comments: [],
      });
    }

    // Get comment details from main comments table
    const comments = data.Items.map((item) => ({
      comment_id: item.comment_id,
      comment_text: item.comment_text,
      umap_x: item.umap_x,
      umap_y: item.umap_y,
      cluster_id: item.cluster_id,
      layer_id: item.layer_id,
      moderation_status: item.moderation_status || "pending",
    }));

    return res.json({
      status: "success",
      message: "Comments retrieved successfully",
      comments: comments,
      total_comments: comments.length,
    });
  } catch (err: any) {
    logger.error(`Error in handle_GET_topicMod_comments: ${err.message}`);
    return res.json({
      status: "error",
      message: "Error retrieving comments",
      error: err.message,
    });
  }
}

/**
 * POST /api/v3/topicMod/moderate
 * Applies moderation actions to topics or individual comments
 */
export async function handle_POST_topicMod_moderate(req: Request, res: Response) {
  try {
    const { conversation_id, topic_key, comment_ids, action, moderator } = req.body;
    
    if (!conversation_id || !action || !moderator) {
      return res.json({
        status: "error",
        message: "conversation_id, action, and moderator are required",
      });
    }

    if (!["accept", "reject", "meta"].includes(action)) {
      return res.json({
        status: "error",
        message: "action must be 'accept', 'reject', or 'meta'",
      });
    }

    const zid = await Conversation.getZidFromConversationId(conversation_id);
    if (!zid) {
      return res.json({
        status: "error",
        message: "Could not find conversation for conversation_id",
      });
    }

    const moderate_conversation_id = zid.toString();
    const now = new Date().toISOString();
    
    // If topic_key is provided, moderate entire topic
    if (topic_key) {
      logger.info(`Moderating entire topic ${topic_key} as ${action}`);
      
      // Update topic moderation status
      const topicParams = {
        TableName: "Delphi_TopicModerationStatus",
        Key: {
          conversation_id: moderate_conversation_id,
          topic_key: topic_key,
        },
        UpdateExpression: "SET moderation_status = :status, moderator = :mod, moderated_at = :time",
        ExpressionAttributeValues: {
          ":status": action,
          ":mod": moderator,
          ":time": now,
        },
        ReturnValues: "ALL_NEW" as const,
      };

      try {
        await docClient.send(new UpdateCommand(topicParams));
      } catch (err: any) {
        if (err.name === "ResourceNotFoundException") {
          // Create the record if it doesn't exist
          const putParams = {
            TableName: "Delphi_TopicModerationStatus",
            Item: {
              conversation_id: moderate_conversation_id,
              topic_key: topic_key,
              moderation_status: action,
              moderator: moderator,
              moderated_at: now,
            },
          };
          await docClient.send(new PutCommand(putParams));
        } else {
          throw err;
        }
      }

      // Update individual comments in the topic
      const commentsParams = {
        TableName: "Delphi_CommentClusters",
        KeyConditionExpression: "conversation_id = :cid AND topic_key = :tk",
        ExpressionAttributeValues: {
          ":cid": moderate_conversation_id,
          ":tk": topic_key,
        },
      };

      const commentsData = await docClient.send(new QueryCommand(commentsParams));
      
      if (commentsData.Items && commentsData.Items.length > 0) {
        // Update moderation status in main comments table
        const moderationStatus = action === "accept" ? 1 : (action === "reject" ? -1 : 0);
        const isMeta = action === "meta" ? true : false;
        
        for (const comment of commentsData.Items) {
          const comment_id = comment.comment_id;
          
          // Update in comments table
          await pgQueryP(
            "UPDATE comments SET mod = ($1), is_meta = ($2) WHERE zid = ($3) AND tid = ($4)",
            [moderationStatus, isMeta, zid, comment_id]
          );
        }
      }
    }
    
    // If comment_ids are provided, moderate individual comments
    if (comment_ids && Array.isArray(comment_ids)) {
      logger.info(`Moderating ${comment_ids.length} individual comments as ${action}`);
      
      const moderationStatus = action === "accept" ? 1 : (action === "reject" ? -1 : 0);
      const isMeta = action === "meta" ? true : false;
      
      for (const comment_id of comment_ids) {
        await pgQueryP(
          "UPDATE comments SET mod = ($1), is_meta = ($2) WHERE zid = ($3) AND tid = ($4)",
          [moderationStatus, isMeta, zid, comment_id]
        );
      }
    }

    return res.json({
      status: "success",
      message: `Moderation action '${action}' applied successfully`,
      moderated_at: now,
    });
  } catch (err: any) {
    logger.error(`Error in handle_POST_topicMod_moderate: ${err.message}`);
    return res.json({
      status: "error",
      message: "Error applying moderation action",
      error: err.message,
    });
  }
}

/**
 * GET /api/v3/topicMod/proximity
 * Retrieves UMAP proximity data for visualization
 */
export async function handle_GET_topicMod_proximity(req: Request, res: Response) {
  try {
    const conversation_id = req.query.conversation_id as string;
    const layer_id = req.query.layer_id as string || "0";
    
    if (!conversation_id) {
      return res.json({
        status: "error",
        message: "conversation_id is required",
      });
    }

    const zid = await Conversation.getZidFromConversationId(conversation_id);
    if (!zid) {
      return res.json({
        status: "error",
        message: "Could not find conversation for conversation_id",
      });
    }

    const proximity_conversation_id = zid.toString();
    logger.info(`Fetching proximity data for conversation ${proximity_conversation_id}, layer ${layer_id}`);

    // Query UMAP coordinates from comment clusters
    const params = {
      TableName: "Delphi_CommentClusters",
      KeyConditionExpression: "conversation_id = :cid",
      FilterExpression: "layer_id = :lid",
      ExpressionAttributeValues: {
        ":cid": proximity_conversation_id,
        ":lid": layer_id,
      },
    };

    const data = await docClient.send(new QueryCommand(params));
    
    if (!data.Items || data.Items.length === 0) {
      return res.json({
        status: "success",
        message: "No proximity data found",
        proximity_data: [],
      });
    }

    // Format proximity data for visualization
    const proximityData = data.Items.map((item) => ({
      comment_id: item.comment_id,
      umap_x: item.umap_x,
      umap_y: item.umap_y,
      cluster_id: item.cluster_id,
      comment_text: item.comment_text,
      moderation_status: item.moderation_status || "pending",
    }));

    return res.json({
      status: "success",
      message: "Proximity data retrieved successfully",
      proximity_data: proximityData,
      total_points: proximityData.length,
    });
  } catch (err: any) {
    logger.error(`Error in handle_GET_topicMod_proximity: ${err.message}`);
    return res.json({
      status: "error",
      message: "Error retrieving proximity data",
      error: err.message,
    });
  }
}

/**
 * GET /api/v3/topicMod/hierarchy
 * Retrieves hierarchical cluster structure for circle pack visualization
 */
export async function handle_GET_topicMod_hierarchy(req: Request, res: Response) {
  try {
    const conversation_id = req.query.conversation_id as string;
    
    if (!conversation_id) {
      return res.json({
        status: "error",
        message: "conversation_id is required",
      });
    }

    const zid = await Conversation.getZidFromConversationId(conversation_id);
    if (!zid) {
      return res.json({
        status: "error",
        message: "Could not find conversation for conversation_id",
      });
    }

    const hierarchy_conversation_id = zid.toString();
    logger.info(`Fetching hierarchy data for conversation ${hierarchy_conversation_id}`);

    // Query cluster structure from DynamoDB
    const params = {
      TableName: "Delphi_CommentClustersStructureKeywords",
      KeyConditionExpression: "conversation_id = :cid",
      ExpressionAttributeValues: {
        ":cid": hierarchy_conversation_id,
      },
    };

    const data = await docClient.send(new QueryCommand(params));
    
    if (!data.Items || data.Items.length === 0) {
      return res.json({
        status: "success",
        message: "No hierarchy data found",
        hierarchy: null,
      });
    }

    // Process and structure the hierarchy data
    const clusters = data.Items;
    logger.info(`Found ${clusters.length} clusters in DynamoDB`);
    
    // Debug: log layer distribution
    const layerCounts = {};
    clusters.forEach(cluster => {
      const layer = cluster.layer_id;
      layerCounts[layer] = (layerCounts[layer] || 0) + 1;
    });
    logger.info(`Layer distribution:`, layerCounts);
    
    // Debug: log sample clusters from each layer
    Object.keys(layerCounts).forEach(layer => {
      const sampleCluster = clusters.find(c => c.layer_id.toString() === layer.toString());
      if (sampleCluster) {
        logger.info(`Sample Layer ${layer} cluster:`, {
          cluster_key: sampleCluster.cluster_key,
          layer_id: sampleCluster.layer_id,
          cluster_id: sampleCluster.cluster_id,
          size: sampleCluster.size,
          has_parent: !!sampleCluster.parent_cluster,
          has_children: !!(sampleCluster.child_clusters && sampleCluster.child_clusters.length > 0),
          parent_cluster: sampleCluster.parent_cluster,
          child_clusters: sampleCluster.child_clusters
        });
      } else {
        logger.error(`No sample cluster found for layer ${layer}`);
      }
    });
    
    const hierarchyMap = new Map();
    const layers = new Map();

    // First pass: create all nodes
    clusters.forEach((cluster) => {
      const key = cluster.cluster_key;
      const layerId = cluster.layer_id;
      const clusterId = cluster.cluster_id;
      
      if (!layers.has(layerId)) {
        layers.set(layerId, []);
      }
      
      const node = {
        id: key,
        name: `Layer ${layerId} Cluster ${clusterId}`,
        layer: layerId,
        clusterId: clusterId,
        size: cluster.size || 0,
        topic_name: cluster.topic_name || cluster.llm_topic_name || cluster.keywords_string,
        children: [],
        parentId: null,
        data: cluster
      };
      
      hierarchyMap.set(key, node);
      layers.get(layerId).push(node);
    });

    // Second pass: INVERT DynamoDB parent-child relationships for circle pack
    // DynamoDB: Layer 3 has parent Layer 2 (Layer 3 merges INTO Layer 2)
    // Circle pack needs: Layer 2 CONTAINS Layer 3 (Layer 2 is bigger circle containing Layer 3)
    clusters.forEach((cluster) => {
      const key = cluster.cluster_key;
      const node = hierarchyMap.get(key);
      
      // If this cluster HAS a parent in DynamoDB, make that parent contain THIS cluster as a child
      if (cluster.parent_cluster && cluster.parent_cluster.layer_id !== undefined && cluster.parent_cluster.cluster_id !== undefined) {
        const parentKey = `layer${cluster.parent_cluster.layer_id}_${cluster.parent_cluster.cluster_id}`;
        const parentNode = hierarchyMap.get(parentKey);
        if (parentNode) {
          // INVERTED: The "parent" in DynamoDB becomes the container in circle pack
          parentNode.children.push(node);
          node.parentId = parentKey;
          logger.info(`Circle pack: ${parentKey} contains ${key}`);
        } else {
          logger.warn(`Parent node ${parentKey} not found for child ${key}`);
        }
      } else {
        logger.info(`No parent found for cluster ${key} - treating as root`);
      }
    });

    // For circle pack: Layer 3 = BIGGEST OUTERMOST containers, Layer 0 = SMALLEST INNERMOST  
    // We want Layer 3 clusters as the roots (big outer circles)
    const layer3Nodes = Array.from(hierarchyMap.values()).filter(node => node.layer === 3);
    const roots = layer3Nodes;
    
    logger.info(`Hierarchy building results:`);
    logger.info(`Total nodes created: ${hierarchyMap.size}`);
    logger.info(`Root nodes found: ${roots.length}`);
    logger.info(`Root nodes by layer:`, roots.reduce((acc, root) => {
      acc[root.layer] = (acc[root.layer] || 0) + 1;
      return acc;
    }, {}));
    
    // Debug: Check parent-child relationships
    let totalChildRelationships = 0;
    const nodesWithChildren = [];
    hierarchyMap.forEach(node => {
      totalChildRelationships += node.children.length;
      if (node.children.length > 0) {
        nodesWithChildren.push(`${node.id}(${node.children.length})`);
      }
    });
    logger.info(`Total parent-child relationships: ${totalChildRelationships}`);
    logger.info(`Nodes with children: ${nodesWithChildren.slice(0, 5).join(', ')}`);
    logger.info(`Layer 3 nodes with children: ${nodesWithChildren.filter(n => n.includes('layer3_')).length}`);
    
    // Debug specific Layer 3 nodes
    roots.forEach(root => {
      if (root.children.length > 0) {
        logger.info(`Layer 3 root ${root.id} has ${root.children.length} children: ${root.children.map(c => c.id).slice(0, 3).join(', ')}`);
      } else {
        logger.info(`Layer 3 root ${root.id} has NO children`);
      }
    });

    // Remove parent references to avoid circular JSON and clean up for D3
    const cleanNode = (node) => {
      const cleaned = {
        id: node.id,
        name: node.name,
        layer: node.layer,
        clusterId: node.clusterId,
        size: node.size,
        topic_name: node.topic_name,
        children: node.children.map(cleanNode)
      };
      if (node.children.length > 0) {
        logger.info(`Cleaning node ${node.id} with ${node.children.length} children`);
      }
      return cleaned;
    };

    // Create the hierarchy structure for D3
    const hierarchy = {
      name: "Topics Hierarchy",
      children: roots.map(cleanNode),
      totalClusters: clusters.length,
      layerCounts: Object.fromEntries(
        Array.from(layers.entries()).map(([layerId, nodes]) => [layerId, nodes.length])
      )
    };

    return res.json({
      status: "success",
      message: "Hierarchy data retrieved successfully",
      hierarchy: hierarchy,
      totalClusters: clusters.length,
      layers: Array.from(layers.keys()).sort(),
    });
  } catch (err: any) {
    logger.error(`Error in handle_GET_topicMod_hierarchy: ${err.message}`);
    return res.json({
      status: "error",
      message: "Error retrieving hierarchy data",
      error: err.message,
    });
  }
}

/**
 * GET /api/v3/topicMod/stats
 * Retrieves moderation statistics
 */
export async function handle_GET_topicMod_stats(req: Request, res: Response) {
  try {
    const conversation_id = req.query.conversation_id as string;
    
    if (!conversation_id) {
      return res.json({
        status: "error",
        message: "conversation_id is required",
      });
    }

    const zid = await Conversation.getZidFromConversationId(conversation_id);
    if (!zid) {
      return res.json({
        status: "error",
        message: "Could not find conversation for conversation_id",
      });
    }

    const stats_conversation_id = zid.toString();
    logger.info(`Fetching moderation stats for conversation ${stats_conversation_id}`);

    // Get moderation status for all topics
    const params = {
      TableName: "Delphi_TopicModerationStatus",
      KeyConditionExpression: "conversation_id = :cid",
      ExpressionAttributeValues: {
        ":cid": stats_conversation_id,
      },
    };

    let data;
    try {
      data = await docClient.send(new QueryCommand(params));
    } catch (err: any) {
      if (err.name === "ResourceNotFoundException") {
        // No moderation data yet
        return res.json({
          status: "success",
          message: "No moderation data available yet",
          stats: {
            total_topics: 0,
            pending: 0,
            accepted: 0,
            rejected: 0,
            meta: 0,
          },
        });
      }
      throw err;
    }
    
    // Calculate statistics
    const stats = {
      total_topics: data.Items?.length || 0,
      pending: 0,
      accepted: 0,
      rejected: 0,
      meta: 0,
    };

    data.Items?.forEach((item) => {
      const status = item.moderation_status;
      if (status === "accept") stats.accepted++;
      else if (status === "reject") stats.rejected++;
      else if (status === "meta") stats.meta++;
      else stats.pending++;
    });

    return res.json({
      status: "success",
      message: "Moderation statistics retrieved successfully",
      stats: stats,
    });
  } catch (err: any) {
    logger.error(`Error in handle_GET_topicMod_stats: ${err.message}`);
    return res.json({
      status: "error",
      message: "Error retrieving moderation statistics",
      error: err.message,
    });
  }
}