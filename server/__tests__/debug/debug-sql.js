import { queryP_readOnly } from '../../src/db/pg-query.js';

async function testSql() {
  try {
    console.log('Testing SQL queries...');

    // Test query to get participants
    console.log('Testing participants query...');
    const participantsQuery = 'SELECT * FROM participants LIMIT 5';
    const participantsResult = await queryP_readOnly(participantsQuery);
    console.log('Participants query result:', participantsResult);

    // Test query to get conversations
    console.log('Testing conversations query...');
    const conversationsQuery = 'SELECT * FROM conversations LIMIT 5';
    const conversationsResult = await queryP_readOnly(conversationsQuery);
    console.log('Conversations query result:', conversationsResult);

    // Test query to get a specific conversation
    console.log('Testing specific conversation query...');
    const specificConversationQuery = 'SELECT * FROM conversations WHERE zid = 20';
    const specificConversationResult = await queryP_readOnly(specificConversationQuery);
    console.log('Specific conversation query result:', specificConversationResult);

    // Test query to get participants for a specific user
    console.log('Testing participants for user query...');
    const participantsForUserQuery = 'SELECT zid, mod FROM participants WHERE uid = 58';
    const participantsForUserResult = await queryP_readOnly(participantsForUserQuery);
    console.log('Participants for user query result:', participantsForUserResult);

    // Test the actual query used in the getConversations function
    console.log('Testing getConversations query...');
    const getConversationsQuery = `
      SELECT "conversations".* 
      FROM "conversations" 
      WHERE ("conversations"."owner" = 58) 
      ORDER BY "conversations"."created" DESC 
      LIMIT 999
    `;
    const getConversationsResult = await queryP_readOnly(getConversationsQuery);
    console.log('getConversations query result:', getConversationsResult);

    // Test the processConversations function by checking if the zinvites table has entries
    console.log('Testing zinvites query...');
    const zinvitesQuery = 'SELECT * FROM zinvites WHERE zid IN (17, 18, 19, 20)';
    const zinvitesResult = await queryP_readOnly(zinvitesQuery);
    console.log('Zinvites query result:', zinvitesResult);

    // Test the schema of the conversations table
    console.log('Testing conversations table schema...');
    const schemaQuery = `
      SELECT column_name, data_type, character_maximum_length
      FROM information_schema.columns
      WHERE table_name = 'conversations'
      ORDER BY ordinal_position
    `;
    const schemaResult = await queryP_readOnly(schemaQuery);
    console.log('Schema query result:', schemaResult);
  } catch (error) {
    console.error('Error testing SQL:', error);
  } finally {
    process.exit(0);
  }
}

testSql();
