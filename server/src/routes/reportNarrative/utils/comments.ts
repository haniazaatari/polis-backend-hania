import { FilterFunction, PolisRecord } from "../types";
import { PolisConverter } from "./polisConverter";
import { parse } from "csv-parse/sync";
import { sendCommentGroupsSummary } from "../../export";

// Function to get comments as XML and count
export const getCommentsAsXML = async (
  id: number,
  filter?: FilterFunction
): Promise<{ xml: string; filteredCount: number }> => {
  try {
    const resp = await sendCommentGroupsSummary(id, undefined, false, filter);
    const xml = PolisConverter.convertToXml(resp as string);

    // Count filtered comments
    const records = parse(resp as string, {
      columns: true,
      skip_empty_lines: true,
    }) as PolisRecord[];
    const filteredCount = records.length;

    // eslint-disable-next-line no-console
    if (xml.trim().length === 0)
      console.error("No data has been returned by sendCommentGroupsSummary");
    return { xml, filteredCount };
  } catch (e) {
    console.error("Error in getCommentsAsXML:", e);
    throw e; // Re-throw instead of returning empty string
  }
};
