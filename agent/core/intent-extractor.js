// agent/core/intent-extractor.js

// Import the LLM client to make the internal call for extraction.
const { generateResponse } = require('./llm-client'); 

/**
 * Analyzes a user query and the agent's response to extract the thematic scope and key financial entities.
 * This function makes a second, internal LLM call to perform this analysis.
 * 
 * @param {string} userInput - The user's input text.
 * @param {string} llmResponse - The LLM's response to the user's input.
 * @returns {Promise<{thematic_scope: string, entities: Array<object>}>} A promise that resolves to an object 
 *          containing the extracted thematic scope and an array of entities.
 */
async function extractIntentAndEntities(userInput, llmResponse) {
    // This "meta-prompt" instructs the LLM to act as an analyst and extract structured data from the conversation.
    const extractionPrompt = `
        Analyze the following user query and assistant response to determine the thematic scope and key financial entities.

        User Query: "${userInput}"
        Assistant Response: "${llmResponse}"

        **Instructions:**
        1.  **Thematic Scope:** Summarize the user's core goal in a few words. Use a consistent, descriptive label.
            Examples: "company overview", "stock price analysis", "understanding financial metric", "long-term investment thesis", "general chat".
        2.  **Entities:** Identify key financial entities mentioned. For each entity, specify its type and value.
            *   Valid entity types are: 'STOCK_TICKER', 'COMPANY_NAME', 'FINANCIAL_METRIC', 'ECONOMIC_INDICATOR'.
            *   If no financial entities are present, return an empty array for the "entities" key.

        Return your answer ONLY as a valid JSON object with the keys "thematic_scope" and "entities". Do not include any other text or formatting.
        
        Example for a financial query:
        {
          "thematic_scope": "understanding P/E ratio",
          "entities": [
            { "type": "FINANCIAL_METRIC", "value": "P/E ratio" }
          ]
        }
        
        Example for a general query:
        {
          "thematic_scope": "general chat",
          "entities": []
        }
    `;

    try {
        console.log("Intent Extractor: Requesting analysis from LLM...");
        const jsonResponseString = await generateResponse(extractionPrompt);
        
        // The LLM should return a JSON string. We need to parse it.
        // It's good practice to clean up the string in case the LLM adds markdown backticks.
        const cleanedJsonString = jsonResponseString.replace(/```json/g, '').replace(/```/g, '').trim();
        const extractedData = JSON.parse(cleanedJsonString);

        // Basic validation of the parsed object to ensure it has the expected structure.
        if (extractedData && typeof extractedData.thematic_scope === 'string' && Array.isArray(extractedData.entities)) {
            console.log(`Intent Extractor: Successfully extracted scope - "${extractedData.thematic_scope}"`);
            return extractedData;
        } else {
            console.error("Intent Extractor: LLM returned malformed JSON.", extractedData);
            // Fallback to default values if the parsed JSON is not in the expected format.
            return { thematic_scope: 'general_chat', entities: [] };
        }
    } catch (error) {
        console.error("Error during intent extraction:", error);
        // Fallback to default values if the LLM call or JSON parsing fails.
        return { thematic_scope: 'general_chat', entities: [] };
    }
}

// Export the function so it can be used by the agent loop.
module.exports = {
    extractIntentAndEntities
};
