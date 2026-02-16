// agent/data_sources/finance_api.js

// This module will be responsible for fetching data from external financial APIs.
// For now, it uses placeholder data for rapid development and testing.

/**
 * Fetches the latest stock price for a given ticker symbol.
 * 
 * @param {string} ticker - The stock ticker symbol (e.g., 'AAPL', 'MSFT').
 * @returns {Promise<number|null>} The latest price of the stock, or null if an error occurs.
 */
async function fetchStockPrice(ticker) {
    // TODO: Replace this placeholder logic with a real API call to a provider like Alpha Vantage.
    console.log(`[finance_api] Fetching stock price for ${ticker}... (using placeholder data)`);
    
    // A small set of dummy data for predictable testing.
    const dummyPrices = {
        'AAPL': 195.34,
        'MSFT': 410.50,
        'GOOGL': 175.80,
        'TSLA': 180.01,
        'F': 12.50,
        'NVDA': 950.00
    };

    const upperCaseTicker = ticker.toUpperCase();
    if (dummyPrices[upperCaseTicker]) {
        return dummyPrices[upperCaseTicker];
    } else {
        // If the ticker is not in our dummy list, return a random price for demonstration.
        const randomPrice = (Math.random() * 500 + 50).toFixed(2);
        return parseFloat(randomPrice);
    }
}

module.exports = {
    fetchStockPrice,
};
