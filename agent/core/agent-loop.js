const { generateResponse } = require('./llm-client');
const { appendMemory, saveMemory } = require('../memory/memory-store'); 

const { extractIntentAndEntities } = require('./intent-extractor');
const { retrieveRelevantMemories } = require('../memory/memory-retriever');
const { fetchStockPrice } = require('../data_sources/finance_api');
const { fetchNews } = require('../data_sources/news_api');
const { getCik, fetchCompanyFacts, fetchSubmissionMetadata } = require('../data_sources/sec_api');

const SYSTEM_PROMPT = `You are a financial research assistant. Your task is to strictly summarize the provided data to answer the user's query.
Do not add any information that is not present in the provided data.
Strictly adhere to the following output format:

**Summary of Information:**
- [Summary of the first piece of information]
- [Summary of the second piece of information]
...

**Answer to the user's query:**
- [Direct answer to the user's query based *only* on the summarized information]`;


/**
 * Executes a single cycle of the agent's operation.
 * Flow: Extract all intents -> Execute all matching tools concurrently -> Summarize with LLM.
 * 
 * @param {string} userInput - The text input provided by the user.
 * @returns {Promise<{response: string, toolCall: object|null}>} The LLM response and tool call metadata.
 * @throws {Error} If any step in the cycle fails.
 */
async function runAgentCycle(userInput) {
  // Basic validation for user input.
  if (!userInput || typeof userInput.trim() !== 'string' || userInput.trim() === '') {
    throw new Error("Invalid user input provided for agent cycle. Input cannot be empty.");
  }

  const createToolCallMarkdown = (toolName, toolInput, startTime) => {
      const duration = new Date().getTime() - startTime;
      return `\`\`\`tool-output\n` +
          `Tool Used: ${toolName}\n` +
          `Input: ${toolInput}\n` +
          `Duration: ${duration}ms\n` +
          `\`\`\``;
  };

  let contextForMemory = {}; // Holds data fetched from tools, to be saved in memory.
  let augmentedPromptParts = []; // Accumulate parts for the LLM prompt.
  let allToolCalls = []; // Array to store metadata for all tool calls made during the cycle.
  let currentIntent = null;

  try {
    // Extract all intents and entities from the user's query.
    console.log(`Agent loop: Extracting intents from query: "${userInput}"`);
    currentIntent = await extractIntentAndEntities(userInput, "");
    const { intents = [], entities = [] } = currentIntent;

    console.log(`Agent loop: Identified intents: ${JSON.stringify(intents)}`);

    // Build an array of tool Promises (per recognized intent)
    const toolPromises = []; // Each entry: { intentType, promise }

    const availableEntities = [...entities]; // Create a mutable copy of entities to consume.

    for (const intent of intents) {
      
      // Find the index of the first available entity of a given type.
      const findEntityIndex = (type) => 
        availableEntities.findIndex(e => e.type === type && e.value);

      // --- data_request: fetch live stock price ---
      if (intent === 'data_request') {
        const entityIndex = findEntityIndex('STOCK_TICKER');
        if (entityIndex > -1) {
          const tickerEntity = availableEntities[entityIndex];
          console.log(`Agent loop: Queuing fetchStockPrice for ${tickerEntity.value}`);
          const startTime = new Date().getTime();
          toolPromises.push({
            intentType: 'data_request',
            ticker: tickerEntity.value,
            startTime,
            promise: fetchStockPrice(tickerEntity.value),
          });
          availableEntities.splice(entityIndex, 1); // Consume the entity
        }
      }

      // --- news_request: fetch news articles ---
      else if (intent === 'news_request') {
        const tickerEntityIndex = findEntityIndex('STOCK_TICKER');
        if (tickerEntityIndex > -1) {
          const tickerEntity = availableEntities[tickerEntityIndex];
          const fromEntityIndex = findEntityIndex('DATE_FROM');
          const toEntityIndex = findEntityIndex('DATE_TO');

          let fromDateTime, toDateTime;
          if (fromEntityIndex > -1 && toEntityIndex > -1) {
            fromDateTime = availableEntities[fromEntityIndex].value;
            toDateTime = availableEntities[toEntityIndex].value;
            // Consume date entities
            availableEntities.splice(Math.max(fromEntityIndex, toEntityIndex), 1);
            availableEntities.splice(Math.min(fromEntityIndex, toEntityIndex), 1);
          } else {
            const now = new Date();
            const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
            const formatDateTime = (date) =>
              date.toISOString().replace(/[-:]|\..+/g, '').slice(0, 13);
            fromDateTime = formatDateTime(twentyFourHoursAgo);
            toDateTime   = formatDateTime(now);
          }
          console.log(`Agent loop: Queuing fetchNews for ${tickerEntity.value}`);
          const startTime = new Date().getTime();
          toolPromises.push({
            intentType: 'news_request',
            ticker: tickerEntity.value,
            fromDateTime,
            toDateTime,
            startTime,
            promise: fetchNews(tickerEntity.value, { from: fromDateTime, to: toDateTime, limit: 5 }),
          });
          availableEntities.splice(tickerEntityIndex, 1); // Consume the ticker entity
        }
      }

      // --- earnings_request: fetch SEC company facts for EPS data ---
      else if (intent === 'earnings_request') {
        const entityIndex = findEntityIndex('STOCK_TICKER');
        if (entityIndex > -1) {
          const tickerEntity = availableEntities[entityIndex];
          const ticker = tickerEntity.value;
          console.log(`Agent loop: Queuing fetchCompanyFacts for ${ticker}`);
          const startTime = new Date().getTime();
          toolPromises.push({
            intentType: 'earnings_request',
            ticker,
            startTime,
            promise: (async () => {
              const cik = await getCik(ticker);
              if (!cik) return { cik: null, companyFacts: null };
              const companyFacts = await fetchCompanyFacts(cik);
              return { cik, companyFacts };
            })(),
          });
          availableEntities.splice(entityIndex, 1); // Consume the entity
        }
      }

      // --- filing_request: fetch SEC submission metadata ---
      else if (intent === 'filing_request') {
        const entityIndex = findEntityIndex('STOCK_TICKER');
        if (entityIndex > -1) {
          const tickerEntity = availableEntities[entityIndex];
          const ticker = tickerEntity.value;
          console.log(`Agent loop: Queuing fetchSubmissionMetadata for ${ticker}`);
          const startTime = new Date().getTime();
          toolPromises.push({
            intentType: 'filing_request',
            ticker,
            startTime,
            promise: (async () => {
              const cik = await getCik(ticker);
              if (!cik) return { cik: null, submissionMetadata: null };
              const submissionMetadata = await fetchSubmissionMetadata(cik);
              return { cik, submissionMetadata };
            })(),
          });
          availableEntities.splice(entityIndex, 1); // Consume the entity
        }
      }

    } // end for (const intent of intents)

    // Execute all tool promises concurrently using Promise.allSettled
    if (toolPromises.length > 0) {
      console.log(`Agent loop: Executing ${toolPromises.length} tool call(s) concurrently via Promise.allSettled...`);
      const settledResults = await Promise.allSettled(toolPromises.map(t => t.promise));
      console.log(`Agent loop: All tool calls completed.`);

      // Process each settled result and build augmentedPromptParts
      settledResults.forEach((result, idx) => {
        const meta = toolPromises[idx];
        const { intentType, ticker, startTime } = meta;
        const toolName = intentType.replace('_request', ''); // e.g., 'data_request' -> 'data'
        const duration = new Date().getTime() - startTime;
        let toolCallData = {
          toolName: '', // Will be set more specifically inside the conditions
          toolInput: ticker,
          duration
        };
        
        if (result.status === 'rejected') {
          // --- Handle Rejected Promise ---
          const error = result.reason;
          console.error(`Agent loop: Tool call for intent '${intentType}' failed for ${ticker}. Reason:`, error);
          
          let specificToolName = 'unknown_tool';
          let descriptiveInput = ticker; // Default to ticker for error display

          if(intentType === 'data_request') {
            specificToolName = 'fetchStockPrice';
            descriptiveInput = `stock price of ${ticker}`;
          } else if(intentType === 'news_request') {
            specificToolName = 'fetchNews';
            descriptiveInput = `latest news for ${ticker}`;
          } else if(intentType === 'earnings_request') {
            specificToolName = 'fetchCompanyFacts';
            descriptiveInput = `earnings for ${ticker}`;
          } else if(intentType === 'filing_request') {
            specificToolName = 'fetchSubmissionMetadata';
            descriptiveInput = `filings for ${ticker}`;
          }

          toolCallData.toolName = specificToolName;
          toolCallData.toolInput = descriptiveInput; // Use descriptive input for error display
          toolCallData.error = error.message || 'Unknown error';
          allToolCalls.push(toolCallData);

          augmentedPromptParts.push(`I tried to perform the action '${toolName}' for ${ticker}, but it failed with the error: ${error.message}`);
          return; // Continue to the next result
        }

        // --- Handle Fulfilled Promise ---
        const value = result.value;

        // --- Process data_request result ---
        if (intentType === 'data_request') {
          toolCallData.toolName = 'fetchStockPrice';
          toolCallData.toolInput = `stock price of ${ticker}`; // Descriptive input
          const price = value;
          if (price !== null) {
            const outputString = `The current stock price of ${ticker} is ${price}.`;
            augmentedPromptParts.push(outputString);
            contextForMemory.price = { ticker, price };
            toolCallData.output = outputString;
          } else {
            const errorMsg = `Could not retrieve stock price for ${ticker}.`;
            augmentedPromptParts.push(errorMsg);
            toolCallData.error = errorMsg;
          }
          allToolCalls.push(toolCallData);
        }

        // --- Process news_request result ---
        else if (intentType === 'news_request') {
          toolCallData.toolName = 'fetchNews';
          toolCallData.toolInput = `latest news for ${ticker}`; // Descriptive input
          const newsArticles = value;
          const { fromDateTime, toDateTime } = meta;
          if (newsArticles && newsArticles.length > 0) {
            const articlesText = newsArticles.map(a => `- ${a.title} (${a.source.name}): ${a.description}`).join('\n');
            const outputString = `Here are the latest news articles for ${ticker}:\n${articlesText}`;
            augmentedPromptParts.push(outputString);
            contextForMemory.news = { ticker, articles: newsArticles };
            toolCallData.output = outputString;
          } else {
            const errorMsg = `No recent news found for ${ticker} between ${fromDateTime} and ${toDateTime}.`;
            augmentedPromptParts.push(errorMsg);
            toolCallData.error = errorMsg;
          }
          allToolCalls.push(toolCallData);
        }

        // --- Process earnings_request result ---
        else if (intentType === 'earnings_request') {
          toolCallData.toolName = 'fetchCompanyFacts';
          const { cik, companyFacts } = value;
          toolCallData.toolInput = `earnings for ${ticker}`; // Descriptive input

          const earningsData = companyFacts.facts['us-gaap'].EarningsPerShareDiluted;
          if (earningsData && earningsData.units && earningsData.units.USD) {
            // Find the most recent reported EPS
            const recentFacts = earningsData.units.USD.filter(fact => fact.form === '10-K' || fact.form === '10-Q');
            if (recentFacts.length > 0) {
              const mostRecentFact = recentFacts.sort((a, b) => new Date(b.end) - new Date(a.end))[0];
              const outputString = `The most recent diluted EPS for ${ticker} is ${mostRecentFact.val} for the period ending ${mostRecentFact.end}.`;
              augmentedPromptParts.push(outputString);
              contextForMemory.earnings = { ticker, mostRecentFact };
              toolCallData.output = outputString;
            } else {
               const errorMsg = `No recent EPS data found in company filings for ${ticker}.`;
               augmentedPromptParts.push(errorMsg);
               toolCallData.error = errorMsg;
            }
          } else {
            const errorMsg = `Could not find 'EarningsPerShareDiluted' in the company facts for ${ticker}.`;
            augmentedPromptParts.push(errorMsg);
            toolCallData.error = errorMsg;
          }
          allToolCalls.push(toolCallData);
        }

        // --- Process filing_request result ---
        else if (intentType === 'filing_request') {
          toolCallData.toolName = 'fetchSubmissionMetadata';
          const { cik, submissionMetadata } = value;
          toolCallData.toolInput = `filings for ${ticker}`; // Descriptive input

          if (!cik || !submissionMetadata || !submissionMetadata.filings || !submissionMetadata.filings.recent) {
            toolCallData.error = `Could not retrieve submission metadata for ${ticker}. CIK found: ${cik || 'None'}.`;
            augmentedPromptParts.push(toolCallData.error);
            allToolCalls.push(toolCallData);
            return;
          }
          const recentFilings = submissionMetadata.filings.recent;
          const filingsList = Object.keys(recentFilings)
            .map((key, i) => {
              if (key.startsWith('accessionNumber')) {
                const reportDate = recentFilings.reportDate[i];
                const form = recentFilings.form[i];
                return `- ${form} filed on ${reportDate}.`;
              }
              return null;
            }).filter(Boolean).slice(0, 5); // Take top 5 recent
          
          if (filingsList.length > 0) {
            const outputString = `Here are the most recent SEC filings for ${ticker}:\n${filingsList.join('\n')}`;
            augmentedPromptParts.push(outputString);
            contextForMemory.filings = { ticker, recentFilings: filingsList };
            toolCallData.output = outputString;
          } else {
            const errorMsg = `No recent filings found for ${ticker}.`;
            augmentedPromptParts.push(errorMsg);
            toolCallData.error = errorMsg;
          }
          allToolCalls.push(toolCallData);
        }
      });
    } else {
      console.log('Agent loop: No tool-backed intents detected; proceeding directly to LLM response.');
    }
    // Generate the final LLM response with context
    let llmResponse;

    // Check for simple, single-intent queries that can be templated
    const isSimpleDataRequest = currentIntent && currentIntent.intents.length === 1 && currentIntent.intents[0] === 'data_request';

    if (isSimpleDataRequest && contextForMemory.price) {
      console.log('Agent loop: Using simple template for stock price response.');
      const { ticker, price } = contextForMemory.price;

      const templates = [
        `The current stock price for ${ticker} is ${price}.`,
        `As of the latest data, ${ticker} is trading at ${price}.`,
        `${ticker}'s current price is ${price}.`,
        `The price for ${ticker} is currently ${price}.`
      ];
      
      const randomIndex = Math.floor(Math.random() * templates.length);
      llmResponse = templates[randomIndex];
    } else {
      // Fallback to the full LLM for complex or non-templateable queries
      console.log(`Agent loop: Generating final response with accumulated prompt parts.`);
      const finalAugmentedPrompt = augmentedPromptParts.length > 0
        ? `You are a financial research assistant. Your task is to summarize the provided data to answer the user's query.
           Do not add any information that is not present in the provided data.
           Strictly adhere to the following format:
               
           **Summary of Information:**
           - [Summary of the first piece of information]
           - [Summary of the second piece of information]
           ....
               
           **Answer to the user's query:**
           - [Direct answer to the user's query based *only* on the summarized information]
               
           **Original Query:**
           "${userInput}"
               
           **Provided Data:**
           ---
           ${augmentedPromptParts.join('\n\n---\n')}
           ---
           `
        : userInput;

      llmResponse = await generateResponse(finalAugmentedPrompt, SYSTEM_PROMPT);
      console.log(`Agent loop: Received final response from LLM.`);
    }

    const memoryEntryData = {
      user_input: userInput,
      llm_response: llmResponse,
      thematic_scope: currentIntent ? currentIntent.thematic_scope : 'unknown',
      intents: currentIntent ? currentIntent.intents : [],
      entities: currentIntent ? currentIntent.entities : [],
      context: contextForMemory,
    };

    const addedEntry = appendMemory(memoryEntryData);
    if (!addedEntry) {
      throw new Error("Failed to append a valid memory entry. Check logs for details.");
    }
    await saveMemory();

    // Return the final response and all tool call metadata to the UI
    return {
      response: llmResponse,
      toolCall: allToolCalls.length > 0 ? allToolCalls[allToolCalls.length - 1] : null,
      allToolCalls,
    };

  } catch (error) {
    console.error(`Agent Cycle Error: ${error.message}`);
    // Re-throw the error so it can be caught and handled by the entry point (e.g., index.js).
    throw error;
  } finally {
    console.log("Agent cycle finished.");
  }
}

// Export the updated runAgentCycle function.
module.exports = {
  runAgentCycle,
};