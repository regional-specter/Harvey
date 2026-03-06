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

    // Execute all tool promises concurrently
    if (toolPromises.length > 0) {
      console.log(`Agent loop: Executing ${toolPromises.length} tool call(s) concurrently via Promise.all...`);
      const rawResults = await Promise.all(toolPromises.map(t => t.promise));
      console.log(`Agent loop: All tool calls completed.`);

      // Process each result and build augmentedPromptParts
      rawResults.forEach((result, idx) => {
        const meta = toolPromises[idx];
        const { intentType, ticker, startTime } = meta;

        // --- Process data_request result ---
        if (intentType === 'data_request') {
          const price = result;
          const toolCallMarkdown = createToolCallMarkdown('fetchStockPrice', ticker, startTime);
          allToolCalls.push({ toolName: 'fetchStockPrice', toolInput: ticker, duration: new Date().getTime() - startTime });

          if (price !== null) {
            contextForMemory.price = price;
            augmentedPromptParts.push(`The live price of ${ticker} is $${price}.`);
          } else {
            augmentedPromptParts.push(`I could not retrieve the live price for ${ticker}.`);
          }
          augmentedPromptParts.push(toolCallMarkdown);
        }

        // --- Process news_request result ---
        else if (intentType === 'news_request') {
          const newsArticles = result;
          const { fromDateTime, toDateTime } = meta;
          const toolCallMarkdown = createToolCallMarkdown('fetchNews', ticker, startTime);
          allToolCalls.push({ toolName: 'fetchNews', toolInput: ticker, duration: new Date().getTime() - startTime });

          if (newsArticles && newsArticles.length > 0) {
            contextForMemory.news = newsArticles;
            const formattedNews = newsArticles.map(article => {
              const sentimentScore = parseFloat(article.overall_sentiment_score).toFixed(2);
              return `- ${article.title} (Source: ${article.source}) [Sentiment: ${sentimentScore}]`;
            }).join('\n');
            augmentedPromptParts.push(`Here are the relevant news headlines I found for ${ticker} from ${fromDateTime} to ${toDateTime}:\n--- News Headlines ---\n${formattedNews}\n---`);
          } else {
            augmentedPromptParts.push(`I could not find any news for ${ticker} from ${fromDateTime} to ${toDateTime}.`);
          }
          augmentedPromptParts.push(toolCallMarkdown);
        }

        // --- Process earnings_request result ---
        else if (intentType === 'earnings_request') {
          const { cik, companyFacts } = result;
          const toolCallMarkdown = createToolCallMarkdown('fetchCompanyFacts', cik || ticker, startTime);
          allToolCalls.push({ toolName: 'fetchCompanyFacts', toolInput: cik || ticker, duration: new Date().getTime() - startTime });

          if (!cik) {
            augmentedPromptParts.push(`I could not find the CIK for ticker ${ticker}.`);
            augmentedPromptParts.push(toolCallMarkdown);
            return;
          }
          if (!companyFacts || !companyFacts.facts || !companyFacts.facts['us-gaap']) {
            augmentedPromptParts.push(`I could not retrieve company facts for ${ticker} (CIK: ${cik}).`);
            augmentedPromptParts.push(toolCallMarkdown);
            return;
          }

          contextForMemory.companyFacts = companyFacts;

          const fromEntity = entities.find(e => e.type === 'DATE_FROM');
          const toEntity   = entities.find(e => e.type === 'DATE_TO');
          let fromDateTime = null;
          let toDateTime   = null;

          if (fromEntity && toEntity) {
            const fromStr = fromEntity.value.substring(0, 8);
            const toStr   = toEntity.value.substring(0, 8);
            fromDateTime = new Date(
              parseInt(fromStr.substring(0, 4)),
              parseInt(fromStr.substring(4, 6)) - 1,
              parseInt(fromStr.substring(6, 8))
            );
            toDateTime = new Date(
              parseInt(toStr.substring(0, 4)),
              parseInt(toStr.substring(4, 6)) - 1,
              parseInt(toStr.substring(6, 8))
            );
            console.log(`Agent loop: Filtering earnings from ${fromDateTime.toDateString()} to ${toDateTime.toDateString()}`);
          }

          const extractEpsData = (facts, isAnnual, fromFilter, toFilter) => {
            const epsData = [];
            if (!facts || !facts['us-gaap']) return epsData;
            const usGaap = facts['us-gaap'];

            const findMetricKeys = (needle) =>
              Object.keys(usGaap).filter(key => key.toLowerCase().includes(needle));

            const basicKeys   = findMetricKeys('earningspersharebasic');
            const dilutedKeys = findMetricKeys('earningspersharediluted');

            const processUnitsArray = (unitsArray, isBasic) => {
              if (!Array.isArray(unitsArray)) return;
              unitsArray.forEach(unit => {
                if (!unit || !unit.form || !unit.end || unit.val === undefined) return;
                const fiscalDate   = new Date(unit.end);
                const reportPrefix = isAnnual ? '10-K' : '10-Q';
                if (!unit.form.startsWith(reportPrefix)) return;
                if (fromFilter && fiscalDate < fromFilter) return;
                if (toFilter   && fiscalDate > toFilter)   return;

                const dateStr       = fiscalDate.toISOString().split('T')[0];
                let existingEntry   = epsData.find(e => e.date === dateStr && e.form === unit.form);

                if (!existingEntry) {
                  existingEntry = { date: dateStr, form: unit.form, fy: unit.fy, fp: unit.fp };
                  epsData.push(existingEntry);
                }
                if (isBasic) existingEntry.epsBasic   = unit.val;
                else         existingEntry.epsDiluted = unit.val;
              });
            };

            basicKeys.forEach(metricKey => {
              const metric = usGaap[metricKey];
              if (!metric || !metric.units || typeof metric.units !== 'object') return;
              Object.keys(metric.units).forEach(unitName => processUnitsArray(metric.units[unitName], true));
            });

            dilutedKeys.forEach(metricKey => {
              const metric = usGaap[metricKey];
              if (!metric || !metric.units || typeof metric.units !== 'object') return;
              Object.keys(metric.units).forEach(unitName => processUnitsArray(metric.units[unitName], false));
            });

            epsData.sort((a, b) => {
              if (b.fy !== a.fy) return b.fy - a.fy;
              const fpOrder = { 'Q4': 4, 'Q3': 3, 'Q2': 2, 'Q1': 1, 'FY': 5 };
              return (fpOrder[b.fp] || 0) - (fpOrder[a.fp] || 0);
            });
            return epsData;
          };

          let annualReports    = extractEpsData(companyFacts.facts, true,  fromDateTime, toDateTime);
          let quarterlyReports = extractEpsData(companyFacts.facts, false, fromDateTime, toDateTime);

          if (fromDateTime && toDateTime && annualReports.length === 0 && quarterlyReports.length === 0) {
            console.log('Agent loop: No earnings found strictly within requested window; falling back to most recent earnings data.');
            annualReports    = extractEpsData(companyFacts.facts, true,  null, null);
            quarterlyReports = extractEpsData(companyFacts.facts, false, null, null);
          }

          const annualEarningsSummary = annualReports.length > 0
            ? annualReports.slice(0, 3).map(r =>
                `Fiscal Year End: ${r.date} (FY: ${r.fy}), Basic EPS: ${r.epsBasic || 'N/A'}, Diluted EPS: ${r.epsDiluted || 'N/A'}`
              ).join('\n')
            : 'No annual earnings data available for the specified period.';

          const quarterlyEarningsSummary = quarterlyReports.length > 0
            ? quarterlyReports.slice(0, 3).map(r =>
                `Fiscal Qtr End: ${r.date} (FY: ${r.fy}, FP: ${r.fp}), Basic EPS: ${r.epsBasic || 'N/A'}, Diluted EPS: ${r.epsDiluted || 'N/A'}`
              ).join('\n')
            : 'No quarterly earnings data available for the specified period.';

          augmentedPromptParts.push(
            `Here is the earnings data for ${ticker} (CIK: ${cik}):\n` +
            `--- Annual Earnings Reports ---\n${annualEarningsSummary}\n` +
            `--- Quarterly Earnings Reports ---\n${quarterlyEarningsSummary}`
          );
          augmentedPromptParts.push(toolCallMarkdown);
        }

        // --- Process filing_request result ---
        else if (intentType === 'filing_request') {
          const { cik, submissionMetadata } = result;
          const toolCallMarkdown = createToolCallMarkdown('fetchSubmissionMetadata', cik || ticker, startTime);
          allToolCalls.push({ toolName: 'fetchSubmissionMetadata', toolInput: cik || ticker, duration: new Date().getTime() - startTime });

          if (!cik) {
            augmentedPromptParts.push(`I could not find the CIK for ticker ${ticker}.`);
            augmentedPromptParts.push(toolCallMarkdown);
            return;
          }
          if (!submissionMetadata || !submissionMetadata.filings || !submissionMetadata.filings.recent) {
            augmentedPromptParts.push(`I could not retrieve submission metadata for ${ticker} (CIK: ${cik}).`);
            augmentedPromptParts.push(toolCallMarkdown);
            return;
          }

          contextForMemory.submissionMetadata = submissionMetadata;

          const recentFilings   = submissionMetadata.filings.recent;
          const filingForms     = recentFilings.form;
          const accessionNumbers = recentFilings.accessionNumber;
          const reportDates     = recentFilings.reportDate;

          const tenKFilings = [];
          const tenQFilings = [];
          let kCount = 0, qCount = 0;

          for (let i = 0; i < filingForms.length && (kCount < 3 || qCount < 3); i++) {
            const form            = filingForms[i];
            const accessionNumber = accessionNumbers[i];
            const reportDate      = reportDates[i];

            if (form === '10-K' && kCount < 3) {
              tenKFilings.push({ reportDate, accessionNumber, form });
              kCount++;
            } else if (form === '10-Q' && qCount < 3) {
              tenQFilings.push({ reportDate, accessionNumber, form });
              qCount++;
            }
          }

          const formatFilings = (filingList, type) => {
            if (!filingList || filingList.length === 0) return `No recent ${type} filings found.`;
            return filingList.map(filing => {
              const filingUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${filing.accessionNumber.replace(/-/g, '')}/${filing.accessionNumber}.txt`;
              return `- ${type} filed on ${filing.reportDate} ([Link](${filingUrl}))`;
            }).join('\n');
          };

          augmentedPromptParts.push(
            `Here are the most recent SEC filings for ${ticker} (CIK: ${cik}):\n` +
            `--- 10-K Filings (Annual Reports) ---\n${formatFilings(tenKFilings, '10-K')}\n` +
            `--- 10-Q Filings (Quarterly Reports) ---\n${formatFilings(tenQFilings, '10-Q')}`
          );
          augmentedPromptParts.push(toolCallMarkdown);
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