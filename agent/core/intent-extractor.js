const { generateResponse } = require('./llm-client'); 

/**
 * Analyzes a user query and the agent's response to extract the thematic scope, key financial entities, and the event type.
 * 
 * @param {string} userInput - The user's input text.
 * @param {string} llmResponse - The LLM's response to the user's input.
 * @returns {Promise<{thematic_scope: string, entities: Array<object>, event_type: string}>} A promise that resolves to an object 
 *          containing the extracted data.
 */
async function extractIntentAndEntities(userInput, previousTurn = {}) {
    // Default to empty strings if previousTurn is not fully populated
    const prevUserInput = previousTurn.user_input || 'N/A';
    const prevAgentResponse = previousTurn.llm_response || 'N/A';

    // This "meta-prompt" is upgraded to be context-aware.
    const extractionPrompt = `
        Analyze the "Current User Query" to determine its thematic scope, key financial entities, and event type. 
        Use the "Previous Turn" for context to resolve pronouns (like 'it', 'that', 'they') and understand follow-up questions.

        --- Previous Turn (Context) ---
        User: "${prevUserInput}"
        Agent: "${prevAgentResponse}"
        ---

        --- Current User Query ---
        "${userInput}"
        ---

        **Instructions:**
        1.  **Thematic Scope:** Summarize the user's core goal. Examples: "company overview", "stock price analysis", "understanding financial metric", "general chat".
        2.  **Entities:** Identify key financial entities from the "Current User Query". If the query uses a pronoun, infer the entity from the "Previous Turn".
            *   Valid entity types: 'STOCK_TICKER', 'COMPANY_NAME', 'FINANCIAL_METRIC', 'ECONOMIC_INDICATOR'.
            *   Example: If the previous turn was about "AAPL" and the current query is "what about its P/E ratio?", you MUST extract "AAPL" as an entity.
        3.  **Event Type:** Classify the user's query into ONE of the following types: 'data_request', 'financial_query', 'factual_question', 'creative_request', 'user_feedback', 'greeting', 'general_conversation'.

        Return your answer ONLY as a valid JSON object with the keys "thematic_scope", "entities", and "event_type".
    `;

    try {
        console.log("Intent Extractor: Requesting analysis with conversation context...");
        const jsonResponseString = await generateResponse(extractionPrompt);
        
        const cleanedJsonString = jsonResponseString.replace(/```json/g, '').replace(/```/g, '').trim();
        const extractedData = JSON.parse(cleanedJsonString);

        // Validate the response structure
        if (extractedData && 
            typeof extractedData.thematic_scope === 'string' && 
            Array.isArray(extractedData.entities) &&
            typeof extractedData.event_type === 'string') {
            console.log(`Intent Extractor: Successfully extracted scope ("${extractedData.thematic_scope}") and event type ("${extractedData.event_type}").`);
            return extractedData;
        } else {
            console.error("Intent Extractor: LLM returned malformed JSON.", extractedData);
            return { thematic_scope: 'general_chat', entities: [], event_type: 'general_conversation' };
        }
    } catch (error) {
        console.error("Error during stateful intent extraction:", error);
        return { thematic_scope: 'general_chat', entities: [], event_type: 'general_conversation' };
    }
}

// Export the updated function.
module.exports = {
    extractIntentAndEntities
};