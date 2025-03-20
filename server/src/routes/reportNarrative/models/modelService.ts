import Anthropic from "@anthropic-ai/sdk";
import {
  GenerateContentRequest,
  GoogleGenerativeAI,
} from "@google/generative-ai";
import OpenAI from "openai";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);

export const getModelResponse = async (
  model: string,
  system_lore: string,
  prompt_xml: string,
  modelVersion?: string
): Promise<string> => {
  try {
    const gemeniModel = genAI.getGenerativeModel({
      model: modelVersion || "gemini-2.0-pro-exp-02-05",
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 50000, // high for reliability for now.
      },
    });
    const gemeniModelprompt: GenerateContentRequest = {
      contents: [
        {
          parts: [
            {
              text: `
                  ${prompt_xml}
  
                  You MUST respond with a JSON object that follows this EXACT structure:
  
                  \`\`\`json
                  {
                    "key1": "string value",
                    "key2": [
                      {
                        "nestedKey1": 123,
                        "nestedKey2": "another string"
                      }
                    ],
                    "key3": true
                  }
                  \`\`\`
  
                  Make sure the JSON is VALID. DO NOT begin with an array '[' - begin with an object '{' - All keys MUST be enclosed in double quotes. NO trailing comma's should be included after the last element in a block (not valid json). Do NOT include any additional text outside of the JSON object.  Do not provide explanations, only the JSON.
                `,
            },
          ],
          role: "user",
        },
      ],
      systemInstruction: system_lore,
    };
    const openai = new OpenAI();

    switch (model) {
      case "gemini": {
        const respGem = await gemeniModel.generateContent(gemeniModelprompt);
        const result = await respGem.response.text();
        return result;
      }
      case "claude": {
        const responseClaude = await anthropic.messages.create({
          model: modelVersion || "claude-3-7-sonnet-20250219",
          max_tokens: 3000,
          temperature: 0,
          system: system_lore,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: prompt_xml }],
            },
            {
              role: "assistant",
              content: [{ type: "text", text: "{" }],
            },
          ],
        });
        // @ts-expect-error claude api
        return `{${responseClaude?.content[0]?.text}`;
      }
      case "openai": {
        const responseOpenAI = await openai.chat.completions.create({
          model: modelVersion || "o3-mini",
          messages: [
            { role: "system", content: system_lore },
            { role: "user", content: prompt_xml },
          ],
        });
        return responseOpenAI.choices[0].message.content || "";
      }
      default:
        return "";
    }
  } catch (error) {
    console.error("ERROR IN GETMODELRESPONSE", error);
    return `{
      "id": "polis_narrative_error_message",
      "title": "Narrative Error Message",
      "paragraphs": [
        {
          "id": "polis_narrative_error_message",
          "title": "Narrative Error Message",
          "sentences": [
            {
              "clauses": [
                {
                  "text": "There was an error generating the narrative. Please refresh the page once all sections have been generated. It may also be a problem with this model, especially if your content discussed sensitive topics.",
                  "citations": []
                }
              ]
            }
          ]
        }
      ]
    }`;
  }
};
