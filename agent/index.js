const { GoogleGenAI } = require("@google/genai");
require("dotenv").config(); // Shortened way to load

async function getPorscheFacts() {
  // 1. Ensure this exact name is in your .env file (e.g., GEMINI_API_KEY=AIza...)
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("❌ ERROR: API Key is missing. Check your .env file for GEMINI_API_KEY.");
    return;
  }

  try {
    const genAI = new GoogleGenAI({ apiKey });
    
    const prompt = "What's the research work done on STITCH (Grounding Agentic Memory)";
    
    const result = await genAI.models.generateContent({ model: "models/gemini-flash-latest", contents: [{ text: prompt }] });
    const text = result.candidates[0].content.parts[0].text;
    
    console.log(text);
    
  } catch (error) {
    console.error("❌ Error during execution:", error.message);
  }
}

getPorscheFacts();