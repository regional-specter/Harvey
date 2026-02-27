const CIK_TICKER_MAP_URL = 'https://www.sec.gov/files/company_tickers.json';
let cikTickerMap = null; // Cache for the CIK-ticker map

// Basic rate limiting for SEC API calls (10 requests per second)
const SEC_RATE_LIMIT_INTERVAL = 100; // 100ms per request (10 requests/second)
let lastSecRequestTime = 0;

async function rateLimitSecApi() {
    const now = Date.now();
    const timeSinceLastRequest = now - lastSecRequestTime;
    if (timeSinceLastRequest < SEC_RATE_LIMIT_INTERVAL) {
        const timeToWait = SEC_RATE_LIMIT_INTERVAL - timeSinceLastRequest;
        await new Promise(resolve => setTimeout(resolve, timeToWait));
    }
    lastSecRequestTime = Date.now();
}

/**
 * Fetches the CIK-ticker mapping from SEC and caches it.
 * @returns {Promise<object>} The CIK-ticker map.
 */
async function loadCikTickerMap() {
    if (cikTickerMap) {
        return cikTickerMap;
    }

    console.log('[sec_api] Loading CIK-ticker map from SEC...');
    await rateLimitSecApi(); // Respect SEC rate limits
    const response = await fetch(CIK_TICKER_MAP_URL);
    if (!response.ok) {
        throw new Error(`Failed to load CIK-ticker map: ${response.statusText}`);
    }
    const data = await response.json();

    cikTickerMap = {};
    // Handle both array and object shapes from the SEC endpoint
    // - Array: [ { cik_str, ticker, title }, ... ]
    // - Object: { "0": { cik_str, ticker, title }, "1": { ... }, ... }
    if (Array.isArray(data)) {
        for (const entry of data) {
            if (!entry || !entry.ticker || entry.cik_str == null) continue;
            const cik = String(entry.cik_str).padStart(10, '0');
            cikTickerMap[entry.ticker.toUpperCase()] = cik;
        }
    } else if (data && typeof data === 'object') {
        for (const key of Object.keys(data)) {
            const entry = data[key];
            if (!entry || !entry.ticker || entry.cik_str == null) continue;
            const cik = String(entry.cik_str).padStart(10, '0');
            cikTickerMap[entry.ticker.toUpperCase()] = cik;
        }
    } else {
        throw new Error('[sec_api] Unexpected CIK-ticker map format from SEC.');
    }
    console.log('[sec_api] CIK-ticker map loaded and cached.');
    return cikTickerMap;
}

/**
 * Gets the CIK for a given ticker symbol.
 * @param {string} ticker - The stock ticker symbol.
 * @returns {Promise<string|null>} The 10-digit CIK, or null if not found.
 */
async function getCik(ticker) {
    if (!cikTickerMap) {
        await loadCikTickerMap();
    }
    return cikTickerMap[ticker.toUpperCase()] || null;
}

/**
 * Fetches structured company facts (XBRL data) from the SEC EDGAR Company Facts API.
 * This includes financial statements like income statements, balance sheets, etc.
 * @param {string} cik - The 10-digit CIK of the company.
 * @returns {Promise<object|null>} The company facts data, or null if an error occurs.
 */
async function fetchCompanyFacts(cik) {
    if (!cik) {
        console.error('[sec_api] CIK is required to fetch company facts.');
        return null;
    }

    console.log(`[sec_api] Fetching company facts for CIK ${cik} from SEC...`);
    await rateLimitSecApi(); // Respect SEC rate limits
    const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 404) {
                console.warn(`[sec_api] No company facts found for CIK ${cik}.`);
                return null;
            }
            throw new Error(`HTTP error fetching company facts! status: ${response.status}`);
        }
        const data = await response.json();
        console.log(`[sec_api] Successfully fetched company facts for CIK ${cik}.`);
        return data;
    } catch (error) {
        console.error(`[sec_api] Error fetching company facts for CIK ${cik}:`, error.message);
        return null;
    }
}

/**
 * Fetches submission metadata for a given CIK from the SEC EDGAR Filing Query API.
 * @param {string} cik - The 10-digit CIK of the company.
 * @returns {Promise<object|null>} The submission metadata, or null if an error occurs.
 */
async function fetchSubmissionMetadata(cik) {
    if (!cik) {
        console.error('[sec_api] CIK is required to fetch submission metadata.');
        return null;
    }

    console.log(`[sec_api] Fetching submission metadata for CIK ${cik} from SEC...`);
    await rateLimitSecApi(); // Respect SEC rate limits
    const url = `https://data.sec.gov/submissions/CIK${cik}.json`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 404) {
                console.warn(`[sec_api] No submission metadata found for CIK ${cik}.`);
                return null;
            }
            throw new Error(`HTTP error fetching submission metadata! status: ${response.status}`);
        }
        const data = await response.json();
        console.log(`[sec_api] Successfully fetched submission metadata for CIK ${cik}.`);
        return data;
    } catch (error) {
        console.error(`[sec_api] Error fetching submission metadata for CIK ${cik}:`, error.message);
        return null;
    }
}

module.exports = {
    getCik,
    fetchCompanyFacts,
    fetchSubmissionMetadata,
};
