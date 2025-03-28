import { CreateTableCommand, DeleteItemCommand, DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import config from '../config.js';
import logger from './logger.js';

export default class DynamoStorageService {
  client;
  tableName;
  cacheDisabled;

  constructor(tableName, disableCache) {
    const credentials = {
      accessKeyId: config.awsAccessKeyId,
      secretAccessKey: config.awsSecretAccessKey
    };
    const clientConfig = { region: config.awsRegion, credentials };
    if (config.dynamoDbEndpoint) {
      clientConfig.endpoint = config.dynamoDbEndpoint;
    }
    this.client = new DynamoDBClient(clientConfig);
    this.tableName = tableName;
    this.cacheDisabled = disableCache || false;
  }

  async initTable() {
    try {
      const describeCmd = new DescribeTableCommand({
        TableName: this.tableName
      });
      await this.client.send(describeCmd);
      logger.info(`Table "${this.tableName}" already exists.`);
    } catch (error) {
      if (error.name === 'ResourceNotFoundException') {
        logger.info(`Table "${this.tableName}" not found. Creating now...`);
        const createCmd = new CreateTableCommand({
          TableName: this.tableName,
          AttributeDefinitions: [
            { AttributeName: 'rid_section_model', AttributeType: 'S' },
            { AttributeName: 'timestamp', AttributeType: 'S' }
          ],
          KeySchema: [
            { AttributeName: 'rid_section_model', KeyType: 'HASH' },
            { AttributeName: 'timestamp', KeyType: 'RANGE' }
          ],
          ProvisionedThroughput: {
            ReadCapacityUnits: 5,
            WriteCapacityUnits: 5
          }
        });
        await this.client.send(createCmd);
        logger.info(`Table "${this.tableName}" created successfully.`);
      } else {
        throw error;
      }
    }
  }

  async putItem(item) {
    const params = {
      TableName: this.tableName,
      Item: item
    };
    const command = new PutCommand(params);
    try {
      const response = await this.client.send(command);
      return response;
    } catch (error) {
      logger.error(error);
    }
  }

  async queryItemsByRidSectionModel(rid_section_model) {
    const params = {
      TableName: this.tableName,
      KeyConditionExpression: 'rid_section_model = :rid_section_model',
      ExpressionAttributeValues: {
        ':rid_section_model': rid_section_model
      }
    };
    const command = new QueryCommand(params);
    if (this.cacheDisabled) {
      return [];
    }
    try {
      const data = await this.client.send(command);
      return data.Items;
    } catch (error) {
      logger.error('Error querying items:', error);
    }
  }

  async deleteReportItem(rid_section_model, timestamp) {
    const params = {
      TableName: this.tableName,
      Key: {
        rid_section_model: rid_section_model,
        timestamp: timestamp
      }
    };
    const command = new DeleteCommand(params);
    try {
      const response = await this.client.send(command);
      logger.info('Item deleted successfully:', response);
      return response;
    } catch (error) {
      logger.error('Error deleting item:', error);
    }
  }

  async deleteAllByReportID(reportIdPrefix) {
    if (!reportIdPrefix) {
      return;
    }
    let lastEvaluatedKey = undefined;
    do {
      const scanParams = {
        TableName: this.tableName,
        FilterExpression: 'begins_with(rid_section_model, :reportIdPrefix)',
        ExpressionAttributeValues: {
          ':reportIdPrefix': String(reportIdPrefix)
        },
        ExclusiveStartKey: lastEvaluatedKey
      };
      const scanCommand = new ScanCommand(scanParams);
      let itemsToDelete;
      try {
        const scanResponse = await this.client.send(scanCommand);
        itemsToDelete = scanResponse.Items;
        lastEvaluatedKey = scanResponse.LastEvaluatedKey;
        if (!itemsToDelete || itemsToDelete.length === 0) {
          break;
        }
      } catch (_scanError) {
        return;
      }
      const deletePromises = itemsToDelete.map(async (item) => {
        const rid_section_model = item.rid_section_model;
        const timestamp = item.timestamp;
        const deleteParams = {
          TableName: this.tableName,
          Key: {
            rid_section_model: { S: rid_section_model },
            timestamp: { S: timestamp }
          }
        };
        const deleteItemCommand = new DeleteItemCommand(deleteParams);
        try {
          await this.client.send(deleteItemCommand);
        } catch (error) {
          logger.error('Error deleting dynamo item:', error);
        }
      });
      await Promise.all(deletePromises);
    } while (lastEvaluatedKey);
  }

  async getAllByReportID(reportIdPrefix) {
    if (!reportIdPrefix) {
      return [];
    }
    const scanParams = {
      TableName: this.tableName,
      FilterExpression: 'begins_with(rid_section_model, :reportIdPrefix)',
      ExpressionAttributeValues: {
        ':reportIdPrefix': String(reportIdPrefix)
      }
    };
    const scanCommand = new ScanCommand(scanParams);
    try {
      const scanResponse = await this.client.send(scanCommand);
      const items = scanResponse.Items;
      if (!items || items.length === 0) {
        return [];
      }
      return items;
    } catch (_scanError) {
      return;
    }
  }
}
