const { runAgentCycle } = require('./core/agent-loop');
const { loadMemory, saveMemory, getMemoryEntries } = require('./memory/memory-store');
const { setLogger, log, error } = require('./core/logger');

// --- Initialization ---

/**
 * Sets the logger for the entire agent.
 * This is the entry point for the UI to inject its logging mechanism.
 * @param {function(string): void} loggerFunc - The callback function for logging.
 */
function setAgentLogger(loggerFunc) {
    setLogger(loggerFunc);
}

// This function is intended to be called once when the agent application starts.
// It loads existing memory from storage and prepares the agent.
async function initializeAgent() {
    try {
        await loadMemory(); // Load existing memory from file (e.g., memory.json)
        log("Agent core initialized. Memory loaded.");
        return true; // Indicate successful initialization
    } catch (e) {
        error("Agent core initialization failed:", e.message);
        // In a real application, you might want more robust error handling here.
        // For now, we'll log the error and return false, indicating initialization failure.
        return false; 
    }
}

/**
 * Handles user input. It determines if the input is a command (like '/summary')
 * or a regular chat message, then invokes the appropriate agent logic.
 * * @param {string} userInput - The raw input string provided by the user from the UI.
 * @returns {Promise<string>} A promise that resolves to the string output to be displayed to the user.
 * This could be an LLM response, command output, or an error message.
 */
async function handleUserInput(userInput) {
    // Trim leading/trailing whitespace from the input for cleaner processing.
    const trimmedInput = userInput.trim();

    // --- Command Handling ---
    // Check if the input starts with a '/' which indicates a command.
    if (trimmedInput.startsWith('/')) {
        // Extract the command name by removing the leading '/'.
        const command = trimmedInput.substring(1); 

        switch (command) {
            case 'summary':
                log("Agent core: Command received - /summary");
                const allMemories = getMemoryEntries(); // Get all memories

                // Map over memories to truncate llm_response for cleaner display
                const truncatedMemories = allMemories.map(entry => {
                    const MAX_SUMMARY_LENGTH = 150; // Define maximum length for llm_response in summary
                    let displayResponse = entry.llm_response;
                    if (displayResponse.length > MAX_SUMMARY_LENGTH) {
                        displayResponse = displayResponse.substring(0, MAX_SUMMARY_LENGTH).trim() + "... (truncated)";
                    }
                    return {
                        ...entry, // Copy all other properties of the memory entry
                        llm_response: displayResponse // Override with the truncated response
                    };
                });

                // Stringify the truncated memories for display
                return `--- Memory Summary ---\n${JSON.stringify(truncatedMemories, null, 2)}\n----------------------`;
            
            // Future commands can be added here, e.g.:
            // case 'help':
            //     return "Available commands: /summary, /help";
            // case 'clear_memory':
            //     // logic to clear memory, then save
            //     return "Memory cleared.";

            default:
                // If the command is not recognized, inform the user.
                return `Unknown command: /${command}. Type '/help' (not yet implemented) for available commands.`;
        }
    } else {
        // --- Chat Input Handling ---
        // If the input is not a command, treat it as a regular chat message.
        try {
            log(`Agent core: Processing chat input: "${userInput}"`);
            // Call the agent's core cycle to generate an LLM response.
            const llmResponse = await runAgentCycle(userInput);
            return llmResponse;
        } catch (e) {
            // If any part of the agent cycle fails, catch the error.
            error(`Agent core error during chat processing for input "${userInput}":`, e.message);
            // Return a user-friendly error message.
            return `An error occurred while processing your request: ${e.message}`;
        }
    }
}

// Export the functions that the UI will need to interact with the agent.
module.exports = {
    initializeAgent,
    handleUserInput,
    setAgentLogger,
    // getMemoryEntries could also be exported if the UI needs to display memories in a structured way,
    // but handleUserInput with '/summary' covers the current requirement.
};