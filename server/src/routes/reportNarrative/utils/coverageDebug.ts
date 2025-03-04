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
  // DEBUG: Log function entry
  console.log(`DEBUG: logModelCoverage called for ${sectionName}`);
  console.log(
    `DEBUG: Environment check: ${process.env.DEBUG_NARRATIVE_COVERAGE_WRITE_TO_DISK}`
  );

  try {
    // Create debug directory structure
    const debugDir = path.join(__dirname, "../../../../debug/coverage");
    console.log(`DEBUG: Creating directory at ${debugDir}`);

    await fs.mkdir(debugDir, { recursive: true });
    console.log(`DEBUG: Directory created or already exists`);

    const timestamp = new Date()
      .toISOString()
      .replace(/:/g, "-")
      .replace(/\./g, "-");
    const filename = `${rid}_${sectionName}_${timestamp}.json`;

    console.log(`DEBUG: Writing file ${filename}`);

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

    // Log the full path before writing
    const fullPath = path.join(debugDir, filename);
    console.log(`DEBUG: Full file path: ${fullPath}`);

    await fs.writeFile(fullPath, JSON.stringify(debugData, null, 2), "utf8");

    console.log(
      `SUCCESS: Coverage debug for ${sectionName} saved to debug/coverage/${filename}`
    );
  } catch (error) {
    console.error(
      `ERROR: Failed saving coverage debug data: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    console.error(
      `ERROR: Stack trace: ${
        error instanceof Error ? error.stack : "No stack trace"
      }`
    );
  }
}
