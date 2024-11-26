import { Response } from "express";
import fail from "../utils/fail";
import { getZidForRid } from "../utils/zinvite";

import { sjiUncertainty } from "../prompts/report_experimental/sji-example/uncertainty";

export async function handle_GET_reportNarrative(
  req: {
    p: { rid: string };
  },
  res: Response
) {
  const { rid } = req.p;

  try {
    const zid = await getZidForRid(rid);
    if (!zid) {
      fail(res, 404, "polis_error_report_narrative_notfound");
      return;
    }

    // For now just return hello world
    res.json({
      narrative: "A narrative report summarizing a polis conversation, Nov 26.",
      uncertainty: sjiUncertainty,
    });
  } catch (err) {
    const msg =
      err instanceof Error && err.message && err.message.startsWith("polis_")
        ? err.message
        : "polis_err_report_narrative";
    fail(res, 500, msg, err);
  }
}
