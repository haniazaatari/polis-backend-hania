import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
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
}
