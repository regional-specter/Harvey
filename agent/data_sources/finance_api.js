const API_KEY = process.env.ALPHA_VANTAGE_API_KEY;

/**
 * Fetches the latest stock price for a given ticker symbol using the Alpha Vantage API.
 * 
 * @param {string} ticker - The stock ticker symbol (e.g., 'AAPL', 'MSFT').
 * @returns {Promise<number|null>} The latest price of the stock, or null if an error occurs.
 */
async function fetchStockPrice(ticker) {
    // 1. Check if the API key is available.
    if (!API_KEY) {
        console.error("[finance_api] ERROR: ALPHA_VANTAGE_API_KEY is not set in the .env file.");
        return null;
    }
    
    console.log(`[finance_api] Fetching LIVE stock price for ${ticker} from Alpha Vantage...`);

    // 2. Construct the API URL.
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${API_KEY}`;

    try {
        // 3. Make the HTTP request.
        const response = await fetch(url);
        if (!response.ok) {
            // Handle non-successful HTTP responses (e.g., 404, 500).
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // 4. Parse the response and extract the price.
        // The price is located in the '05. price' field of the 'Global Quote' object.
        if (data['Global Quote'] && data['Global Quote']['05. price']) {
            const price = parseFloat(data['Global Quote']['05. price']);
            console.log(`[finance_api] Successfully fetched price for ${ticker}: ${price}`);
            return price;
        } else if (data['Note']) {
            // Alpha Vantage returns a 'Note' field if the API call limit is reached.
            console.warn(`[finance_api] Alpha Vantage API Note: ${data['Note']}`);
            return null;
        } else {
            // Handle cases where the response doesn't contain the expected data.
            console.warn(`[finance_api] Could not find price for ${ticker} in API response.`, data);
            return null;
        }

    } catch (error) {
        // Handle network errors or other issues with the fetch call.
        console.error(`[finance_api] Error fetching stock price for ${ticker}:`, error.message);
        return null;
    }
}

module.exports = {
    fetchStockPrice,
};