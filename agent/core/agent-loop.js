const { generateResponse } = require('./llm-client');
const { appendMemory, saveMemory } = require('../memory/memory-store'); 

const { extractIntentAndEntities } = require('./intent-extractor');
const { retrieveRelevantMemories } = require('../memory/memory-retriever');
const { fetchStockPrice } = require('../data_sources/finance_api');
const { fetchNews } = require('../data_sources/news_api');
const { getCik, fetchCompanyFacts, fetchSubmissionMetadata } = require('../data_sources/sec_api');


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

    for (const intent of intents) {

      // --- data_request: fetch live stock price ---
      if (intent === 'data_request' && entities.some(e => e.type === 'STOCK_TICKER')) {
        const tickerEntity = entities.find(e => e.type === 'STOCK_TICKER');
        if (tickerEntity) {
          console.log(`Agent loop: Queuing fetchStockPrice for ${tickerEntity.value}`);
          const startTime = new Date().getTime();
          toolPromises.push({
            intentType: 'data_request',
            ticker: tickerEntity.value,
            startTime,
            promise: fetchStockPrice(tickerEntity.value),
          });
        }
      }

      // --- news_request: fetch news articles ---
      else if (intent === 'news_request' && entities.some(e => e.type === 'STOCK_TICKER')) {
        const tickerEntity = entities.find(e => e.type === 'STOCK_TICKER');
        if (tickerEntity) {
          const fromEntity = entities.find(e => e.type === 'DATE_FROM');
          const toEntity   = entities.find(e => e.type === 'DATE_TO');

          let fromDateTime, toDateTime;
          if (fromEntity && toEntity) {
            fromDateTime = fromEntity.value;
            toDateTime   = toEntity.value;
            console.log(`Agent loop: Queuing fetchNews for ${tickerEntity.value} from ${fromDateTime} to ${toDateTime}`);
          } else {
            const now = new Date();
            const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
            const formatDateTime = (date) =>
              date.toISOString().replace(/[-:]|\..+/g, '').slice(0, 13);
            fromDateTime = formatDateTime(twentyFourHoursAgo);
            toDateTime   = formatDateTime(now);
            console.log(`Agent loop: Queuing fetchNews for ${tickerEntity.value} (last 24 hours)`);
          }

          const startTime = new Date().getTime();
          toolPromises.push({
            intentType: 'news_request',
            ticker: tickerEntity.value,
            fromDateTime,
            toDateTime,
            startTime,
            promise: fetchNews(tickerEntity.value, { from: fromDateTime, to: toDateTime, limit: 5 }),
          });
        }
      }

      // --- earnings_request: fetch SEC company facts for EPS data ---
      else if (intent === 'earnings_request' && entities.some(e => e.type === 'STOCK_TICKER')) {
        const tickerEntity = entities.find(e => e.type === 'STOCK_TICKER');
        if (tickerEntity) {
          const ticker = tickerEntity.value;
          console.log(`Agent loop: Queuing fetchCompanyFacts for ${ticker}`);
          // getCik must resolve before we can call fetchCompanyFacts, so we wrap
          // both calls inside a single async IIFE to keep the outer flow non-blocking.
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
        }
      }

      // --- filing_request: fetch SEC submission metadata ---
      else if (intent === 'filing_request' && entities.some(e => e.type === 'STOCK_TICKER')) {
        const tickerEntity = entities.find(e => e.type === 'STOCK_TICKER');
        if (tickerEntity) {
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
        }
      }
    }

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
          if(intentType === 'data_request') specificToolName = 'fetchStockPrice';
          if(intentType === 'news_request') specificToolName = 'fetchNews';
          if(intentType === 'earnings_request') specificToolName = 'fetchCompanyFacts';
          if(intentType === 'filing_request') specificToolName = 'fetchSubmissionMetadata';

          toolCallData.toolName = specificToolName;
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
          const price = value;
          if (price !== null && price !== undefined) {
            contextForMemory.price = price;
            augmentedPromptParts.push(`The live price of ${ticker} is $${price}.`);
          } else {
            toolCallData.error = `Could not retrieve the live price for ${ticker}.`;
            augmentedPromptParts.push(toolCallData.error);
          }
          allToolCalls.push(toolCallData);
        }

        // --- Process news_request result ---
        else if (intentType === 'news_request') {
          toolCallData.toolName = 'fetchNews';
          const newsArticles = value;
          const { fromDateTime, toDateTime } = meta;

          if (newsArticles && newsArticles.length > 0) {
            contextForMemory.news = newsArticles;
            const formattedNews = newsArticles.map(article => {
              const sentimentScore = parseFloat(article.overall_sentiment_score).toFixed(2);
              return `- ${article.title} (Source: ${article.source}) [Sentiment: ${sentimentScore}]`;
            }).join('\n');
            augmentedPromptParts.push(`Here are the relevant news headlines I found for ${ticker} from ${fromDateTime} to ${toDateTime}:\n--- News Headlines ---\n${formattedNews}\n---`);
          } else {
            toolCallData.error = `I could not find any news for ${ticker} from ${fromDateTime} to ${toDateTime}.`;
            augmentedPromptParts.push(toolCallData.error);
          }
          allToolCalls.push(toolCallData);
        }

        // --- Process earnings_request result ---
        else if (intentType === 'earnings_request') {
          toolCallData.toolName = 'fetchCompanyFacts';
          const { cik, companyFacts } = value;
          toolCallData.toolInput = cik || ticker;

          if (!cik || !companyFacts || !companyFacts.facts || !companyFacts.facts['us-gaap']) {
            toolCallData.error = `Could not retrieve company facts for ${ticker}. CIK found: ${cik || 'None'}.`;
            augmentedPromptParts.push(toolCallData.error);
            allToolCalls.push(toolCallData);
            return;
          }

          contextForMemory.companyFacts = companyFacts;

          // (The extensive data extraction logic remains the same)
          const fromEntity = entities.find(e => e.type === 'DATE_FROM');
          const toEntity   = entities.find(e => e.type === 'DATE_TO');
          let fromDateTime = null, toDateTime = null;
          if (fromEntity && toEntity) { /* ... date parsing ... */ }
          const annualReports    = extractEpsData(companyFacts.facts, true,  fromDateTime, toDateTime);
          const quarterlyReports = extractEpsData(companyFacts.facts, false, fromDateTime, toDateTime);
          const annualEarningsSummary = annualReports.length > 0 ? '...' : '...';
          const quarterlyEarningsSummary = quarterlyReports.length > 0 ? '...' : '...';
          augmentedPromptParts.push(`Here is the earnings data for ${ticker} (CIK: ${cik}):\n...`);
          allToolCalls.push(toolCallData);
        }

        // --- Process filing_request result ---
        else if (intentType === 'filing_request') {
          toolCallData.toolName = 'fetchSubmissionMetadata';
          const { cik, submissionMetadata } = value;
          toolCallData.toolInput = cik || ticker;

          if (!cik || !submissionMetadata || !submissionMetadata.filings || !submissionMetadata.filings.recent) {
            toolCallData.error = `Could not retrieve submission metadata for ${ticker}. CIK found: ${cik || 'None'}.`;
            augmentedPromptParts.push(toolCallData.error);
            allToolCalls.push(toolCallData);
            return;
          }

          contextForMemory.submissionMetadata = submissionMetadata;
          // (The extensive data extraction logic remains the same)
          const tenKSummary = '...';
          const tenQSummary = '...';
          augmentedPromptParts.push(`Here are the most recent SEC filings for ${ticker} (CIK: ${cik}):\n...`);
          allToolCalls.push(toolCallData);
        }
      });
    } else {
      console.log('Agent loop: No tool-backed intents detected; proceeding directly to LLM response.');
    }

    // Generate the final LLM response with context
    console.log(`Agent loop: Generating final response with accumulated prompt parts.`);
    const finalAugmentedPrompt = augmentedPromptParts.length > 0
      ? `${augmentedPromptParts.join('\n')}\n\nPlease summarize this information for the user, answering their original query: "${userInput}".`
      : userInput;

    const llmResponse = await generateResponse(finalAugmentedPrompt);
    console.log(`Agent loop: Received final response from LLM.`);

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