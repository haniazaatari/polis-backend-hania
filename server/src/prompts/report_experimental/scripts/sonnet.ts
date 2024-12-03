import Anthropic from "@anthropic-ai/sdk";
import { convertXML } from "simple-xml-to-json";
import fs from "fs/promises";

const js2xmlparser = require("js2xmlparser");
const report_id = process.argv[2]

const anthropic = new Anthropic({
  // defaults to process.env["ANTHROPIC_API_KEY"]
  apiKey: "",
});

const getJSONuserMsg = async () => {
  const report_xml_template = await fs.readFile("src/prompts/report_experimental/subtasks/uncertainty.xml", "utf8"); // unsure if this should be uncertainty or group_informed_consensus
  const asJSON = await convertXML(report_xml_template);
  return asJSON;
}

const getCommentsAsJson = async (id: string) => {
  const resp = await fetch(`http://localhost/api/v3/comments?conversation_id=2rumnecbeh&report_id=${id}&moderation=true&mod_gt=0&include_voting_patterns=true`); // this should be rewritten to call internal api or db, not depending on localhost
  const data = await resp.json();
  return data;
}

// STEPS TO RUN: start webpack server on reports then run following in terminal from server directory: npx ts-node src/prompts/report_experimental/scripts/sonnet.ts r7bhuide6netnbr8fxbyh 
// the last arg is the report id
// data needs some transforming / renaming in order to get better response from LLM, which is next step

async function main() {
  const system_lore = await fs.readFile("src/prompts/report_experimental/system.xml", "utf8");
  const json = await getJSONuserMsg();
  const structured_comments = await getCommentsAsJson(report_id);
  json.polisAnalysisPrompt.children[json.polisAnalysisPrompt.children.length - 1].data.content = structured_comments; // insert dynamic report stuff here
  const prompt_xml = js2xmlparser.parse("polis-comments", json); // then convert back to xml
  const msg = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1000,
    temperature: 0,
    system: system_lore,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              prompt_xml,
          },
        ],
      },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "{",
          },
        ],
      },
    ],
  });
  console.log(msg);
}

main().catch(console.error);
