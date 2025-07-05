import { v4 as uuidv4 } from "uuid";
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import Config from "../config";
import logger from "./logger";

// Initialize DynamoDB
const dynamoDbConfig: any = {
  region: Config.AWS_REGION || "us-east-1",
};

if (Config.dynamoDbEndpoint) {
  dynamoDbConfig.endpoint = Config.dynamoDbEndpoint;
  dynamoDbConfig.credentials = {
    accessKeyId: "DUMMYIDEXAMPLE",
    secretAccessKey: "DUMMYEXAMPLEKEY",
  };
} else if (Config.AWS_ACCESS_KEY_ID && Config.AWS_SECRET_ACCESS_KEY) {
  dynamoDbConfig.credentials = {
    accessKeyId: Config.AWS_ACCESS_KEY_ID,
    secretAccessKey: Config.AWS_SECRET_ACCESS_KEY,
  };
}

const dynamoDbClient = new DynamoDB(dynamoDbConfig);
const docClient = DynamoDBDocument.from(dynamoDbClient);

const TABLE_NAME = "treevite";

// Types
interface InviteCode {
  code: string;
  conversation_id: number;
  parent_code?: string;
  created_by_uid?: number;
  used_by_uid?: number;
  wave_number: number;
  created_at: number;
  used_at?: number;
  children_generated: number;
  // Composite keys for efficient queries
  pk: string; // "CONV#{conversation_id}"
  sk: string; // "CODE#{code}"
  gsi1pk?: string; // "CONV#{conversation_id}#WAVE#{wave_number}"
  gsi1sk?: string; // "CREATED#{created_at}"
}

// Generate a user-friendly invite code
export function generateInviteCode(): string {
  const uuid = uuidv4().replace(/-/g, '').toUpperCase();
  const shortCode = uuid.substring(0, 8);
  return shortCode.match(/.{1,4}/g)!.join('-');
}

// Create a new invite code
export async function createInviteCode(
  conversationId: number,
  parentCode?: string,
  createdByUid?: number
): Promise<string> {
  const code = generateInviteCode();
  
  // Get parent info if exists
  let waveNumber = 0;
  if (parentCode) {
    const parent = await getInviteCode(conversationId, parentCode);
    if (parent) {
      waveNumber = parent.wave_number + 1;
    }
  }
  
  const now = Date.now();
  const item: InviteCode = {
    code,
    conversation_id: conversationId,
    parent_code: parentCode,
    created_by_uid: createdByUid,
    wave_number: waveNumber,
    created_at: now,
    children_generated: 0,
    // Composite keys
    pk: `CONV#${conversationId}`,
    sk: `CODE#${code}`,
    gsi1pk: `CONV#${conversationId}#WAVE#${waveNumber}`,
    gsi1sk: `CREATED#${now}`,
  };
  
  try {
    await docClient.put({
      TableName: TABLE_NAME,
      Item: item,
      ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
    });
    
    // Update parent's children count if exists
    if (parentCode) {
      await docClient.update({
        TableName: TABLE_NAME,
        Key: {
          pk: `CONV#${conversationId}`,
          sk: `CODE#${parentCode}`,
        },
        UpdateExpression: "ADD children_generated :inc",
        ExpressionAttributeValues: {
          ":inc": 1,
        },
      });
    }
    
    logger.info(`Created invite code ${code} for conversation ${conversationId}`);
    return code;
  } catch (error) {
    logger.error("Error creating invite code:", error);
    throw error;
  }
}

// Get a specific invite code
export async function getInviteCode(
  conversationId: number,
  code: string
): Promise<InviteCode | null> {
  try {
    const result = await docClient.get({
      TableName: TABLE_NAME,
      Key: {
        pk: `CONV#${conversationId}`,
        sk: `CODE#${code}`,
      },
    });
    
    return result.Item as InviteCode || null;
  } catch (error) {
    logger.error("Error getting invite code:", error);
    return null;
  }
}

// Redeem an invite code
export async function redeemInviteCode(
  conversationId: number,
  code: string,
  uid: number
): Promise<InviteCode> {
  const inviteCode = await getInviteCode(conversationId, code);
  
  if (!inviteCode) {
    throw new Error("Invalid invite code");
  }
  
  if (inviteCode.used_by_uid) {
    throw new Error("Invite code already used");
  }
  
  // Mark as used
  await docClient.update({
    TableName: TABLE_NAME,
    Key: {
      pk: `CONV#${conversationId}`,
      sk: `CODE#${code}`,
    },
    UpdateExpression: "SET used_by_uid = :uid, used_at = :now",
    ExpressionAttributeValues: {
      ":uid": uid,
      ":now": Date.now(),
    },
  });
  
  return { ...inviteCode, used_by_uid: uid };
}

// Get all codes for a conversation (admin view)
export async function getConversationInviteTree(
  conversationId: number
): Promise<InviteCode[]> {
  try {
    const result = await docClient.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": `CONV#${conversationId}`,
      },
    });
    
    return (result.Items || []) as InviteCode[];
  } catch (error) {
    logger.error("Error getting invite tree:", error);
    return [];
  }
}

// Get codes by wave (useful for analytics)
export async function getCodesByWave(
  conversationId: number,
  waveNumber: number
): Promise<InviteCode[]> {
  try {
    const result = await docClient.query({
      TableName: TABLE_NAME,
      IndexName: "gsi1", // You'll need to create this GSI
      KeyConditionExpression: "gsi1pk = :pk",
      ExpressionAttributeValues: {
        ":pk": `CONV#${conversationId}#WAVE#${waveNumber}`,
      },
    });
    
    return (result.Items || []) as InviteCode[];
  } catch (error) {
    logger.error("Error getting codes by wave:", error);
    return [];
  }
}

// Get unused child codes for a user
export async function getUserInviteCodes(
  conversationId: number,
  uid: number
): Promise<string[]> {
  // First find codes used by this user
  const allCodes = await getConversationInviteTree(conversationId);
  const userCode = allCodes.find(c => c.used_by_uid === uid);
  
  if (!userCode) {
    return [];
  }
  
  // Find unused children of this code
  const childCodes = allCodes
    .filter(c => c.parent_code === userCode.code && !c.used_by_uid)
    .map(c => c.code);
  
  return childCodes;
}

// Generate multiple child codes
export async function generateChildCodes(
  conversationId: number,
  parentCode: string,
  count: number = 5,
  createdByUid?: number
): Promise<string[]> {
  const codes: string[] = [];
  
  for (let i = 0; i < count; i++) {
    const code = await createInviteCode(conversationId, parentCode, createdByUid);
    codes.push(code);
  }
  
  return codes;
}

// Create table (run this once)
export async function createInviteCodesTable(): Promise<void> {
  try {
    await dynamoDbClient.createTable({
      TableName: TABLE_NAME,
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
        { AttributeName: "gsi1pk", AttributeType: "S" },
        { AttributeName: "gsi1sk", AttributeType: "S" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "gsi1",
          KeySchema: [
            { AttributeName: "gsi1pk", KeyType: "HASH" },
            { AttributeName: "gsi1sk", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
          ProvisionedThroughput: {
            ReadCapacityUnits: 5,
            WriteCapacityUnits: 5,
          },
        },
      ],
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5,
      },
    });
    
    logger.info("Created invite codes table");
  } catch (error: any) {
    if (error.name === "ResourceInUseException") {
      logger.info("Invite codes table already exists");
    } else {
      logger.error("Error creating invite codes table:", error);
      throw error;
    }
  }
}