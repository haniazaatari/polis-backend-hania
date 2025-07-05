#!/usr/bin/env node

/**
 * Test script for invite code system
 * Run with: npx ts-node src/scripts/test-invite-codes.ts
 */

import * as dotenv from "dotenv";
dotenv.config();

import {
  createInviteCodesTable,
  createInviteCode,
  getConversationInviteTree,
  generateChildCodes,
  redeemInviteCode,
} from "../utils/invite-codes";

async function testInviteCodeSystem() {
  console.log("🚀 Testing Invite Code System with DynamoDB...\n");

  try {
    // 1. Create table
    console.log("1. Creating DynamoDB table...");
    await createInviteCodesTable();
    console.log("✅ Table ready\n");

    // 2. Create root invite code
    console.log("2. Creating root invite code...");
    const conversationId = 123; // Test conversation
    const rootCode = await createInviteCode(conversationId, undefined, 1);
    console.log(`✅ Root code created: ${rootCode}\n`);

    // 3. Generate child codes
    console.log("3. Generating child codes...");
    const childCodes = await generateChildCodes(conversationId, rootCode, 3, 1);
    console.log(`✅ Child codes created: ${childCodes.join(", ")}\n`);

    // 4. Simulate user redeeming a code
    console.log("4. Redeeming first child code...");
    await redeemInviteCode(conversationId, childCodes[0], 2);
    console.log(`✅ Code ${childCodes[0]} redeemed by user 2\n`);

    // 5. Get full tree
    console.log("5. Fetching invite tree...");
    const tree = await getConversationInviteTree(conversationId);
    console.log("✅ Invite tree:");
    tree.forEach(code => {
      const indent = "  ".repeat(code.wave_number);
      const status = code.used_by_uid ? `✓ Used by ${code.used_by_uid}` : "Available";
      console.log(`${indent}${code.code} (Wave ${code.wave_number}) - ${status}`);
    });

    console.log("\n🎉 All tests passed!");
    
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

// Run the test
testInviteCodeSystem()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
  });