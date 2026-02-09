// A simple singleton logger module to allow decoupling the agent core from the UI.
// It can direct logs to the console or to a UI-provided callback.

let loggerCallback = null;

/**
 * Sets a callback function to be used for logging.
 * When this is set, logs will be sent to the callback instead of the console.
 * @param {function(string): void} callback - The function to call with log messages.
 */
function setLogger(callback) {
    loggerCallback = callback;
}

/**
 * Logs a standard message.
 * @param {...any} args - The arguments to log, same as console.log.
 */
function log(...args) {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
    if (loggerCallback) {
        loggerCallback(message);
    } else {
        console.log(...args);
    }
}

/**
 * Logs an error message.
 * @param {...any} args - The arguments to log, same as console.error.
 */
function error(...args) {
    const message = `❌ ${args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ')}`;
    if (loggerCallback) {
        loggerCallback(message);
    } else {
        console.error(...args);
    }
}

module.exports = {
    setLogger,
    log,
    error,
};
