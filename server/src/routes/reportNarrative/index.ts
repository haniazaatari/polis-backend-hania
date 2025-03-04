import { Response } from "express";
import fail from "../../utils/fail";
import { getZidForRid } from "../../utils/zinvite";
import DynamoStorageService from "../../utils/storage";
import fs from "fs/promises";
import { QueryParams } from "./types";
import { getTotalCommentCount } from "./coverage/metrics";
import {
  handle_GET_groupInformedConsensus,
  handle_GET_uncertainty,
  handle_GET_groups,
  handle_GET_topics,
} from "./sections";

export async function handle_GET_reportNarrative(
  req: { p: { rid: string }; query: QueryParams },
  res: Response
) {
  let storage;
  if (process.env.AWS_REGION && process.env.AWS_REGION?.trim().length > 0) {
    storage = new DynamoStorageService(
      process.env.AWS_REGION,
      "report_narrative_store",
      req.query.noCache === "true"
    );
  }
  const modelParam = req.query.model || "openai";
  const modelVersionParam = req.query.modelVersion;

  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Transfer-Encoding": "chunked",
  });
  const { rid } = req.p;

  res.write(`POLIS-PING: AI bootstrap`);

  // @ts-expect-error flush - calling due to use of compression
  res.flush();

  const zid = await getZidForRid(rid);
  if (!zid) {
    fail(res, 404, "polis_error_report_narrative_notfound");
    return;
  }

  // Get total comment count for the conversation
  const totalComments = await getTotalCommentCount(zid);
  console.log(`\n=== COMMENT COVERAGE SUMMARY ===`);
  console.log(`TOTAL COMMENTS IN CONVERSATION: ${totalComments}`);
  console.log(`================================\n`);

  res.write(`POLIS-PING: retrieving system lore`);

  // @ts-expect-error flush - calling due to use of compression
  res.flush();

  const system_lore = await fs.readFile(
    "src/report_experimental/system.xml",
    "utf8"
  );

  res.write(`POLIS-PING: retrieving stream`);

  // @ts-expect-error flush - calling due to use of compression
  res.flush();
  try {
    const promises = [
      handle_GET_groupInformedConsensus({
        rid,
        storage,
        res,
        model: modelParam as string,
        system_lore,
        zid,
        modelVersion: modelVersionParam as string,
        totalComments,
      }),
      handle_GET_uncertainty({
        rid,
        storage,
        res,
        model: modelParam as string,
        system_lore,
        zid,
        modelVersion: modelVersionParam as string,
        totalComments,
      }),
      handle_GET_groups({
        rid,
        storage,
        res,
        model: modelParam as string,
        system_lore,
        zid,
        modelVersion: modelVersionParam as string,
        totalComments,
      }),
      handle_GET_topics({
        rid,
        storage,
        res,
        model: modelParam as string,
        system_lore,
        zid,
        modelVersion: modelVersionParam as string,
        totalComments,
      }),
    ];
    await Promise.all(promises);
  } catch (err) {
    // @ts-expect-error flush - calling due to use of compression
    res.flush();
    console.log(err);
    const msg =
      err instanceof Error && err.message && err.message.startsWith("polis_")
        ? err.message
        : "polis_err_report_narrative";
    fail(res, 500, msg, err);
  }
}

// Re-export section handlers for direct access if needed
export * from "./sections";
