// agent/core/intent-extractor.js

// Import the LLM client to make the internal call for extraction.
const { generateResponse } = require('./llm-client'); 

/**
 * Analyzes a user query and the agent's response to extract the thematic scope, key financial entities, and the event type.
 * 
 * @param {string} userInput - The user's input text.
 * @param {string} llmResponse - The LLM's response to the user's input.
 * @returns {Promise<{thematic_scope: string, entities: Array<object>, event_type: string}>} A promise that resolves to an object 
 *          containing the extracted data.
 */
async function extractIntentAndEntities(userInput, llmResponse) {
    // This "meta-prompt" is updated to include event_type extraction.
    const extractionPrompt = `
        Analyze the following user query and assistant response to determine the thematic scope, key financial entities, and the event type.

        User Query: "${userInput}"
        Assistant Response: "${llmResponse}"

        **Instructions:**
        1.  **Thematic Scope:** Summarize the user's core goal in a few words. Use a consistent, descriptive label.
            Examples: "company overview", "stock price analysis", "understanding financial metric", "long-term investment thesis", "general chat".
        2.  **Entities:** Identify key financial entities mentioned. For each entity, specify its type and value.
            *   Valid entity types are: 'STOCK_TICKER', 'COMPANY_NAME', 'FINANCIAL_METRIC', 'ECONOMIC_INDICATOR'.
            *   If no financial entities are present, return an empty array for the "entities" key.
        3.  **Event Type:** Classify the user's query into ONE of the following types: 'financial_query', 'factual_question', 'creative_request', 'user_feedback', 'greeting', 'general_conversation'.

        Return your answer ONLY as a valid JSON object with the keys "thematic_scope", "entities", and "event_type". Do not include any other text or formatting.
        
        Example for a financial query:
        {
          "thematic_scope": "understanding P/E ratio",
          "entities": [
            { "type": "FINANCIAL_METRIC", "value": "P/E ratio" }
          ],
          "event_type": "financial_query"
        }
        
        Example for a greeting:
        {
          "thematic_scope": "general chat",
          "entities": [],
          "event_type": "greeting"
        }
    `;

    try {
        console.log("Intent Extractor: Requesting analysis from LLM for scope, entities, and event type...");
        const jsonResponseString = await generateResponse(extractionPrompt);
        
        const cleanedJsonString = jsonResponseString.replace(/```json/g, '').replace(/```/g, '').trim();
        const extractedData = JSON.parse(cleanedJsonString);

        // Update validation to include the new 'event_type' field.
        if (extractedData && 
            typeof extractedData.thematic_scope === 'string' && 
            Array.isArray(extractedData.entities) &&
            typeof extractedData.event_type === 'string') {
            console.log(`Intent Extractor: Successfully extracted scope ("${extractedData.thematic_scope}") and event type ("${extractedData.event_type}").`);
            return extractedData;
        } else {
            console.error("Intent Extractor: LLM returned malformed JSON.", extractedData);
            // Fallback to default values, including for event_type.
            return { thematic_scope: 'general_chat', entities: [], event_type: 'general_conversation' };
        }
    } catch (error) {
        console.error("Error during intent extraction:", error);
        // Fallback to default values if the LLM call or JSON parsing fails.
        return { thematic_scope: 'general_chat', entities: [], event_type: 'general_conversation' };
    }
}

// Export the updated function.
module.exports = {
    extractIntentAndEntities
};