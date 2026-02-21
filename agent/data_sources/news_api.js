const API_KEY = process.env.ALPHA_VANTAGE_API_KEY;

/**
 * Fetches news for a given ticker symbol from the Alpha Vantage API.
 * Can fetch latest news or historical news within a specified date range.
 * 
 * @param {string} ticker - The stock ticker symbol (e.g., 'AAPL', 'MSFT').
 * @param {object} [options] - Optional parameters for the query.
 * @param {string} [options.from] - The start date for historical news (YYYYMMDDTHHMM).
 * @param {string} [options.to] - The end date for historical news (YYYYMMDDTHHMM).
 * @param {number} [options.limit=50] - The number of results to return.
 * @returns {Promise<object[]|null>} An array of news articles, or null if an error occurs.
 */
async function fetchNews(ticker, { from, to, limit = 50 } = {}) {
    if (!API_KEY) {
        console.error("[news_api] ERROR: ALPHA_VANTAGE_API_KEY is not set in the .env file.");
        return null;
    }

    console.log(`[news_api] Fetching news for ${ticker} from Alpha Vantage...`);

    let url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${ticker}&limit=${limit}&apikey=${API_KEY}`;
    
    if (from) {
        url += `&time_from=${from}`;
    }
    if (to) {
        url += `&time_to=${to}`;
    }

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.feed) {
            console.log(`[news_api] Successfully fetched ${data.feed.length} news articles for ${ticker}.`);
            return data.feed;
        } else if (data['Note']) {
            console.warn(`[news_api] Alpha Vantage API Note: ${data['Note']}`);
            return null;
        } else {
            console.warn(`[news_api] Could not find news for ${ticker} in API response.`, data);
            return null;
        }

    } catch (error) {
        console.error(`[news_api] Error fetching news for ${ticker}:`, error.message);
        return null;
    }
}

module.exports = {
    fetchNews,
};
