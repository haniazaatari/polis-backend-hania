import fs from "fs/promises";
import path from "path";
import { convertXML } from "simple-xml-to-json";
import { extractCitedCommentIds } from "../coverage/metrics";

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
  modelResponse: any,
  modelName?: string
): Promise<void> {
  // DEBUG: Log function entry
  console.log(`DEBUG: logModelCoverage called for ${sectionName}`);
  console.log(
    `DEBUG: Environment check: ${process.env.DEBUG_NARRATIVE_COVERAGE_WRITE_TO_DISK}`
  );

  try {
    // Create debug directory structure with model subfolder
    const safeModelName = modelName ? modelName.replace(/[^a-zA-Z0-9-_]/g, "_") : "unknown";
    const debugDir = path.join(__dirname, "../../../../debug/coverage", safeModelName);
    console.log(`DEBUG: Creating directory at ${debugDir}`);

    await fs.mkdir(debugDir, { recursive: true });
    console.log(`DEBUG: Directory created or already exists`);

    const timestamp = new Date()
      .toISOString()
      .replace(/:/g, "-")
      .replace(/\./g, "-");
    const filename = `${rid}_${sectionName}_${safeModelName}_${timestamp}.json`;

    console.log(`DEBUG: Writing file ${filename}`);

    // Parse XML to JSON if it's a string (XML)
    let inputCommentsJson = null;
    try {
      if (typeof inputComments === "string") {
        // This is XML, try to convert to JSON
        inputCommentsJson = convertXML(inputComments);
      }
    } catch (xmlError) {
      console.error(
        `WARNING: Could not parse XML: ${
          xmlError instanceof Error ? xmlError.message : String(xmlError)
        }`
      );
    }

    // Calculate coverage statistics
    const citedCommentIds = extractCitedCommentIds(modelResponse);

    // Count total comments in the input
    let totalCommentsProvided = 0;
    if (inputCommentsJson) {
      try {
        // Try to count comments from the parsed XML structure
        // This is a simplified approach - adjust based on actual XML structure
        const comments = inputCommentsJson.comments?.children || [];
        totalCommentsProvided = comments.length;
      } catch (countError) {
        console.error(
          `WARNING: Could not count comments in XML: ${
            countError instanceof Error
              ? countError.message
              : String(countError)
          }`
        );
      }
    }

    // Create coverage stats
    const coverageStats = {
      totalCommentsProvided,
      citedCommentsCount: citedCommentIds.length,
      coveragePercentage:
        totalCommentsProvided > 0
          ? ((citedCommentIds.length / totalCommentsProvided) * 100).toFixed(
              2
            ) + "%"
          : "N/A",
      citedCommentIds,
    };

    const debugData = {
      coverageStats,
      metadata: {
        section: sectionName,
        rid,
        zid,
        modelName: safeModelName,
        timestamp: new Date().toISOString(),
      },
      inputCommentsXml: inputComments,
      inputCommentsJson,
      modelResponse,
    };

    // Log the full path before writing
    const fullPath = path.join(debugDir, filename);
    console.log(`DEBUG: Full file path: ${fullPath}`);

    await fs.writeFile(fullPath, JSON.stringify(debugData, null, 2), "utf8");

    console.log(
      `SUCCESS: Coverage debug for ${sectionName} saved to debug/coverage/${safeModelName}/${filename}`
    );
    console.log(
      `COVERAGE STATS: Total comments: ${totalCommentsProvided}, Cited: ${citedCommentIds.length}, Coverage: ${coverageStats.coveragePercentage}`
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
