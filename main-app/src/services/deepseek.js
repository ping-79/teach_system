const axios = require("axios");
const env = require("../config/env");

async function createChatCompletion({ systemPrompt, userPrompt, temperature = 0.1 }) {
  if (!env.deepseekApiKey) {
    return null;
  }

  const response = await axios.post(
    `${env.deepseekBaseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      model: env.deepseekModel,
      temperature,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${env.deepseekApiKey}`,
        "Content-Type": "application/json"
      },
      timeout: 60000
    }
  );

  return response.data;
}

function extractJsonContent(responseData) {
  const content = responseData?.choices?.[0]?.message?.content || "{}";
  const fencedMatch = String(content).match(/```json\s*([\s\S]+?)```/i);
  const jsonText = fencedMatch ? fencedMatch[1] : content;
  return JSON.parse(jsonText);
}

module.exports = {
  createChatCompletion,
  extractJsonContent
};
