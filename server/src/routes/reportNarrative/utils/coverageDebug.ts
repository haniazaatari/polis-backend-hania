import fs from "fs/promises";
import path from "path";

/**
 * Logs model inputs and outputs to disk for coverage analysis
 *
 * This utility helps track which comments were sent to the model and
 * which ones it actually referenced in its response.
 */
export async function logModelCoverage(
  sectionName: string,
  rid: string,
  zid: number,
  inputComments: any,
  modelResponse: any
): Promise<void> {
  try {
    // Create debug directory structure
    const debugDir = path.join(__dirname, "../../../../debug/coverage");
    await fs.mkdir(debugDir, { recursive: true });

    const timestamp = new Date()
      .toISOString()
      .replace(/:/g, "-")
      .replace(/\./g, "-");
    const filename = `${rid}_${sectionName}_${timestamp}.json`;

    const debugData = {
      metadata: {
        section: sectionName,
        rid,
        zid,
        timestamp: new Date().toISOString(),
      },
      inputComments,
      modelResponse,
    };

    await fs.writeFile(
      path.join(debugDir, filename),
      JSON.stringify(debugData, null, 2),
      "utf8"
    );

    console.log(
      `Coverage debug for ${sectionName} saved to debug/coverage/${filename}`
    );
  } catch (error) {
    console.error(
      `Error saving coverage debug data: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
