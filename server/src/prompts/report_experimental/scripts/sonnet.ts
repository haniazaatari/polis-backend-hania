import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  // defaults to process.env["ANTHROPIC_API_KEY"]
  apiKey: "my_api_key",
});

async function main() {
  const msg = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1000,
    temperature: 0,
    system: "you are a data journalist...",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "TASK SPECIFIC SUBPROMPT XML XML XML XML... TASK SPECIFIC DATA DATA DATA DATA...",
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
