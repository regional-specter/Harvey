// A simple singleton logger module to allow decoupling the agent core from the UI.
// It can direct logs to the console or to a UI-provided callback.

let loggerCallback = null;

// Store original console methods so we can restore them if needed.
const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
};

/**
 * Sets a callback function to be used for logging and patches global console methods.
 * When a callback is provided, all console output will be redirected to it.
 * @param {function(string): void} callback - The function to call with log messages.
 */
function setLogger(callback) {
    loggerCallback = callback;

    if (callback) {
        // If a logger is provided, patch the console methods to use it.
        console.log = (...args) => {
            const message = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' ');
            callback(message);
        };
        console.error = (...args) => {
            const message = `❌ ${args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg)).join(' ')}`;
            callback(message);
        };
        console.warn = (...args) => {
            const message = `⚠️ ${args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' ')}`;
            callback(message);
        };
        console.info = (...args) => {
            const message = `ℹ️ ${args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' ')}`;
            callback(message);
        };
    } else {
        // If the callback is removed, restore the original console methods.
        console.log = originalConsole.log;
        console.error = originalConsole.error;
        console.warn = originalConsole.warn;
        console.info = originalConsole.info;
    }
}

/**
 * Logs a standard message. This will now go through the patched console.log.
 * @param {...any} args - The arguments to log.
 */
function log(...args) {
    console.log(...args);
}

/**
 * Logs an error message. This will now go through the patched console.error.
 * @param {...any} args - The arguments to log.
 */
function error(...args) {
    console.error(...args);
}

module.exports = {
    setLogger,
    log,
    error,
};