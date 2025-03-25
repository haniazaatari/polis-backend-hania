import { CreateTableCommand, DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import config from '../config.js';
import logger from './logger.js';

/**
 * Service for interacting with DynamoDB
 * Used for storing and retrieving data from DynamoDB
 */
export class DynamoStorageService {
  client;
  tableName;
  cacheDisabled;

  /**
   * Create a new DynamoDB storage service
   * @param {string} tableName - The name of the DynamoDB table
   * @param {boolean} disableCache - Whether to disable caching
   */
  constructor(tableName, disableCache) {
    const credentials = {
      accessKeyId: config.awsAccessKeyId,
      secretAccessKey: config.awsSecretAccessKey
    };

    const clientConfig = {
      region: config.awsRegion,
      credentials
    };

    // Use local DynamoDB endpoint for development if configured
    if (config.dynamoDbEndpoint) {
      clientConfig.endpoint = config.dynamoDbEndpoint;
      logger.info(`Using custom DynamoDB endpoint: ${config.dynamoDbEndpoint}`);
    }

    this.client = new DynamoDBClient(clientConfig);
    this.tableName = tableName;
    this.cacheDisabled = disableCache || false;
  }
  /**
   * Initialize the DynamoDB table
   * Creates the table if it doesn't exist
   * @returns {Promise<boolean>} - Whether the table was created or already existed
   */
  async initTable() {
    try {
      // Check if table exists
      const describeCmd = new DescribeTableCommand({
        TableName: this.tableName
      });
      await this.client.send(describeCmd);
      logger.info(`Table "${this.tableName}" already exists.`);
      return true;
    } catch (error) {
      if (error.name === 'ResourceNotFoundException') {
        logger.info(`Table "${this.tableName}" not found. Creating now...`);

        // Create table with schema for report caching
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
        return true;
      }

      logger.error(`Error checking/creating table "${this.tableName}":`, error);
      throw error;
    }
  }
  /**
   * Store an item in DynamoDB
   * @param {Object} item - The item to store
   * @returns {Promise<Object>} - The response from DynamoDB
   */
  async putItem(item) {
    if (!item) {
      logger.error('Cannot put null/undefined item in DynamoDB');
      return null;
    }

    const params = {
      TableName: this.tableName,
      Item: item
    };

    const command = new PutCommand(params);

    try {
      const response = await this.client.send(command);
      return response;
    } catch (error) {
      logger.error('Error putting item in DynamoDB:', error);
      throw error;
    }
  }

  /**
   * Query items by the rid_section_model key
   * @param {string} rid_section_model - The report ID, section, and model to query
   * @returns {Promise<Array>} - The items that match the query
   */
  async queryItemsByRidSectionModel(rid_section_model) {
    // Return empty array if cache is disabled
    if (this.cacheDisabled) {
      logger.debug('Cache disabled, returning empty array');
      return [];
    }

    const params = {
      TableName: this.tableName,
      KeyConditionExpression: 'rid_section_model = :rid_section_model',
      ExpressionAttributeValues: {
        ':rid_section_model': rid_section_model
      }
    };

    const command = new QueryCommand(params);

    try {
      const data = await this.client.send(command);
      logger.debug(`Found ${data.Items?.length || 0} items for rid_section_model ${rid_section_model}`);
      return data.Items || [];
    } catch (error) {
      logger.error(`Error querying items for rid_section_model ${rid_section_model}:`, error);
      return [];
    }
  }

  /**
   * Delete a report item from DynamoDB
   * @param {string} rid_section_model - The report ID, section, and model
   * @param {string} timestamp - The timestamp of the item
   * @returns {Promise<Object>} - The response from DynamoDB
   */
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
      logger.info(`Item deleted successfully: ${rid_section_model} @ ${timestamp}`);
      return response;
    } catch (error) {
      logger.error(`Error deleting item ${rid_section_model} @ ${timestamp}:`, error);
      throw error;
    }
  }
}
