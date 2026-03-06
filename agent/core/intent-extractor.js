const { generateResponse } = require('./llm-client'); 

/**
 * Analyzes a user query and the agent's response to extract the thematic scope, key financial entities, and all event types (intents).
 * 
 * @param {string} userInput - The user's input text.
 * @param {object} previousTurn - The previous conversation turn for context resolution.
 * @returns {Promise<{thematic_scope: string, entities: Array<object>, intents: Array<string>}>} A promise that resolves to an object 
 *          containing the extracted data, now with an array of intents.
 */
async function extractIntentAndEntities(userInput, previousTurn = {}) {
    // Default to empty strings if previousTurn is not fully populated
    const prevUserInput = previousTurn.user_input || 'N/A';
    const prevAgentResponse = previousTurn.llm_response || 'N/A';

    // This "meta-prompt" is upgraded to be context-aware and support multiple intents.
    const extractionPrompt = `
        Analyze the "Current User Query" to determine its thematic scope, key financial entities, and ALL intended actions. 
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
            *   Valid entity types: 'STOCK_TICKER', 'COMPANY_NAME', 'FINANCIAL_METRIC', 'ECONOMIC_INDICATOR', 'DATE_FROM', 'DATE_TO'.
            *   Crucially, for 'news_request', 'earnings_request', and 'filing_request' intents, you MUST extract the relevant 'STOCK_TICKER' if present.
            *   If a date, year, or date range is specified (e.g., "news from yesterday", "news between 2023-01-01 and 2023-01-31", "news for last week", "news from last month", "earnings for 2024"), extract 'DATE_FROM' and 'DATE_TO' entities. Format these dates as YYYYMMDDTHHMM. If only one date or year is given for a range, infer the other.
            *   **Crucial for relative dates and year-only ranges:** Calculate the exact YYYYMMDDTHHMM based on the *current date* (February 21, 2026), and for a year like "2024" set DATE_FROM to the start of the year (20240101T0000) and DATE_TO to the end of the year (20241231T2359).
            *   Example for DATE_FROM/DATE_TO:
                *   "news from last month for AAPL" (current date: Feb 21, 2026) -> DATE_FROM: '20260101T0000', DATE_TO: '20260131T2359'
                *   "news from last week for AAPL" -> DATE_FROM: '20260214T0000', DATE_TO: '20260221T2359' (assuming today is 2026-02-21)
                *   "earnings of AAPL in 2024" -> DATE_FROM: '20240101T0000', DATE_TO: '20241231T2359'
                *   "news for MSFT on 2023-03-15" -> DATE_FROM: '20230315T0000', DATE_TO: '20230315T2359'
                *   "news for GOOG between 2023-01-01 and 2023-01-07" -> DATE_FROM: '20230101T0000', DATE_TO: '20230107T2359'
            *   Example: If the previous turn was about "AAPL" and the current query is "what about its P/E ratio?", you MUST extract "AAPL" as an entity.
        3.  **Intents:** Identify ALL distinct actions the user is requesting and return them as an array. A single query may contain multiple intents (e.g., asking for both the stock price AND the latest news in one message).
            *   Valid intent types: 'data_request', 'financial_query', 'factual_question', 'creative_request', 'user_feedback', 'greeting', 'general_conversation', 'news_request', 'earnings_request', 'filing_request'.
            *   'news_request': For queries asking for news, headlines, or updates on a specific company or ticker.
            *   'earnings_request': For queries about a company's earnings, revenue, profit, or other financial performance metrics, often for a specific period (e.g., a year or quarter).
            *   'filing_request': For queries asking for SEC filings like 10-K, 10-Q, or other official documents.
            *   'data_request': For queries asking for live market data such as a stock's current price.
            *   **Example:** "What is AAPL's stock price and latest news?" -> intents: ["data_request", "news_request"]
            *   **Example:** "Show me TSLA's earnings and recent SEC filings" -> intents: ["earnings_request", "filing_request"]
            *   **Example:** "Hello, how are you?" -> intents: ["greeting"]

        Return your answer ONLY as a valid JSON object with the keys "thematic_scope", "entities", and "intents".
        The "intents" value MUST be an array of strings, even if there is only one intent (e.g., ["data_request"]).
    `;

    try {
        console.log("Intent Extractor: Requesting analysis with conversation context...");
        const jsonResponseString = await generateResponse(extractionPrompt);
        
        const cleanedJsonString = jsonResponseString.replace(/```json/g, '').replace(/```/g, '').trim();
        const extractedData = JSON.parse(cleanedJsonString);

        // Normalize entities: some models may return an object instead of an array.
        if (extractedData && !Array.isArray(extractedData.entities) && extractedData.entities && typeof extractedData.entities === 'object') {
            const normalizedEntities = [];
            for (const [key, value] of Object.entries(extractedData.entities)) {
                if (value == null) continue;
                if (Array.isArray(value)) {
                    value.forEach(v => {
                        if (v != null) {
                            normalizedEntities.push({ type: key, value: v });
                        }
                    });
                } else {
                    normalizedEntities.push({ type: key, value });
                }
            }
            extractedData.entities = normalizedEntities;
        }

        // Normalize intents: handle legacy single event_type string for backwards compatibility.
        if (extractedData && !Array.isArray(extractedData.intents)) {
            if (typeof extractedData.intents === 'string') {
                // Wrap a bare string into an array.
                extractedData.intents = [extractedData.intents];
            } else if (typeof extractedData.event_type === 'string') {
                // Fall back to the old event_type field if intents is missing entirely.
                console.warn("Intent Extractor: 'intents' array missing; falling back to legacy 'event_type' field.");
                extractedData.intents = [extractedData.event_type];
            } else {
                extractedData.intents = ['general_conversation'];
            }
        }

        // Validate the response structure
        if (extractedData && 
            typeof extractedData.thematic_scope === 'string' && 
            Array.isArray(extractedData.entities) &&
            Array.isArray(extractedData.intents) &&
            extractedData.intents.length > 0) {
            console.log(`Intent Extractor: Successfully extracted scope ("${extractedData.thematic_scope}") and intents (${JSON.stringify(extractedData.intents)}).`);
            return extractedData;
        } else {
            console.error("Intent Extractor: LLM returned malformed JSON.", extractedData);
            return { thematic_scope: 'general_chat', entities: [], intents: ['general_conversation'] };
        }
    } catch (error) {
        console.error("Error during stateful intent extraction:", error);
        return { thematic_scope: 'general_chat', entities: [], intents: ['general_conversation'] };
    }
}

// Export the updated function.
module.exports = {
    extractIntentAndEntities
};