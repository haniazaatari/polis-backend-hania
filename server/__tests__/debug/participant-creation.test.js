/**
 * Test file specifically focusing on participant creation and the fixes
 * for unique constraint violations
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createParticipant, getParticipantId } from '../../src/repositories/participant/participantRepository.js';
import { processVote } from '../../src/services/vote/voteService.js';
import dbHelpers from '../setup/db-test-helpers.js';

describe('Participant Creation', () => {
  let client;
  let testZid;
  let testUid;

  beforeAll(async () => {
    console.log('Setting up test environment for participant creation tests');

    // Create test user and conversation
    const userResult = await dbHelpers.pool.query('INSERT INTO users (email, hname) VALUES ($1, $2) RETURNING uid', [
      'test.participant.creation@example.com',
      'Test User'
    ]);
    testUid = userResult.rows[0].uid;

    const convResult = await dbHelpers.pool.query(
      'INSERT INTO conversations (owner, topic, is_active, is_anon, is_public, use_xid_whitelist) VALUES ($1, $2, true, true, true, false) RETURNING zid',
      [testUid, 'Test Conversation for Participant Creation']
    );
    testZid = convResult.rows[0].zid;

    console.log(`Test setup complete: uid=${testUid}, zid=${testZid}`);
  });

  beforeEach(async () => {
    client = await dbHelpers.startTransaction();
  });

  afterEach(async () => {
    await dbHelpers.rollbackTransaction(client);
  });

  afterAll(async () => {
    console.log('Cleaning up test environment');
    await dbHelpers.cleanTables(['conversations', 'users']);
    await dbHelpers.closePool();
  });

  it('should create a participant successfully', async () => {
    const participant = await createParticipant(testZid, testUid);
    expect(participant).toBeDefined();
    expect(participant.zid).toBe(testZid);
    expect(participant.uid).toBe(testUid);
    expect(participant.pid).toBeGreaterThan(0);
  });

  it('should retrieve an existing participant id correctly', async () => {
    // First create a participant
    const participant = await createParticipant(testZid, testUid);

    // Then retrieve its pid
    const pid = await getParticipantId(testZid, testUid);

    expect(pid).toBe(participant.pid);
  });

  it('should handle duplicate participant creation gracefully', async () => {
    // Create a participant
    const participant1 = await createParticipant(testZid, testUid);

    // Try to create the same participant again, which should throw
    // a unique constraint violation
    try {
      await createParticipant(testZid, testUid);
      expect().fail('Should have thrown a unique constraint violation');
    } catch (err) {
      expect(err.constraint).toBe('participants_zid_uid_key');
    }

    // Now verify we can still get the participant id
    const pid = await getParticipantId(testZid, testUid);
    expect(pid).toBe(participant1.pid);
  });

  it('should handle processVote with existing participant', async () => {
    // Mock the necessary components for processVote
    jest.spyOn(console, 'error').mockImplementation(() => {}); // Silence console errors

    // Create a participant
    const participant = await createParticipant(testZid, testUid);

    // Create a comment to vote on
    const commentResult = await dbHelpers.pool.query(
      "INSERT INTO comments (zid, tid, txt, uid, created, is_seed) VALUES ($1, nextval('comments_tid_seq'), $2, $3, now(), true) RETURNING tid",
      [testZid, 'Test comment for voting', testUid]
    );

    const tid = commentResult.rows[0].tid;

    // Set up vote params
    const voteParams = {
      uid: testUid,
      pid: participant.pid,
      zid: testZid,
      tid,
      vote: 1, // agree
      weight: 0,
      high_priority: false
    };

    // Mock req for processVote
    const req = {
      cookies: {},
      headers: {}
    };

    // Test processVote
    const result = await processVote(voteParams, req, null);

    expect(result).toBeDefined();
    expect(result.currentPid).toBe(participant.pid);

    // Verify the vote was created
    const voteResult = await dbHelpers.pool.query('SELECT * FROM votes WHERE zid = $1 AND tid = $2 AND pid = $3', [
      testZid,
      tid,
      participant.pid
    ]);

    expect(voteResult.rows.length).toBe(1);
    expect(voteResult.rows[0].vote).toBe(1);
  });

  it('should handle processVote with race condition in participant creation', async () => {
    // Create a comment to vote on
    const commentResult = await dbHelpers.pool.query(
      "INSERT INTO comments (zid, tid, txt, uid, created, is_seed) VALUES ($1, nextval('comments_tid_seq'), $2, $3, now(), true) RETURNING tid",
      [testZid, 'Test comment for voting with race condition', testUid]
    );

    const tid = commentResult.rows[0].tid;

    // Set up vote params without a pid to force participant creation
    const voteParams = {
      uid: testUid,
      zid: testZid,
      tid,
      vote: 1, // agree
      weight: 0,
      high_priority: false
    };

    // Mock req for processVote
    const req = {
      cookies: {},
      headers: {}
    };

    // First, create the participant outside the processVote flow
    // to simulate a race condition
    const participant = await createParticipant(testZid, testUid);

    // Now attempt to process the vote, which should handle the existing participant
    const result = await processVote(voteParams, req, null);

    expect(result).toBeDefined();
    expect(result.currentPid).toBe(participant.pid);

    // Verify the vote was created
    const voteResult = await dbHelpers.pool.query('SELECT * FROM votes WHERE zid = $1 AND tid = $2 AND pid = $3', [
      testZid,
      tid,
      participant.pid
    ]);

    expect(voteResult.rows.length).toBe(1);
    expect(voteResult.rows[0].vote).toBe(1);
  });
});
