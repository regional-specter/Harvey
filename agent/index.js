const fs = require('fs');
const path = require('path');
const { runAgentCycle } = require('./core/agent-loop');
const { loadMemory, saveMemory, getMemoryEntries, clearMemory } = require('./memory/memory-store');
const { setLogger, log, error } = require('./core/logger');

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
        // Correctly parse the base command (e.g., "summary" from "/summary --intent ...")
        const commandParts = trimmedInput.split(' ');
        const baseCommand = commandParts[0].substring(1);

        switch (baseCommand) { // Now 'baseCommand' is correctly defined
            case 'summary':
                log("Agent core: Command received - /summary");
                // For summary, we can either fetch from memory directly or use the agent cycle with a specific prompt.
                // For now, let's just return a placeholder. In a future iteration, this could invoke the LLM with a prompt
                // like "Summarize my memories."
                const summaryResponse = await runAgentCycle("Summarize our current conversation and learning.");
                return { response: summaryResponse.response, toolCall: null };
            
            case 'export':
                log("Agent core: Command received - /export");
                // For export, we'd typically write memories to a file. For now, a placeholder.
                const allMemories = getMemoryEntries();
                if (allMemories.length === 0) {
                    return { response: "No memories to export.", toolCall: null };
                }
                const exportContent = JSON.stringify(allMemories, null, 2);
                const exportFileName = `memory_export_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
                fs.writeFileSync(exportFileName, exportContent);
                return { response: `Memories exported to ${exportFileName}`, toolCall: null };

            case 'clear-mem':
                log("Agent core: Command received - /clear-mem");
                await clearMemory();
                return { response: "Memory has been cleared.", toolCall: null };

            default:
                // If the command is not recognized, inform the user.
                return { response: `Unknown command: /${baseCommand}. Type '/help' (not yet implemented) for available commands.`, toolCall: null };
        }
    } else {
        // --- Chat Input Handling ---
        // If the input is not a command, treat it as a regular chat message.
        try {
            log(`Agent core: Processing chat input: "${userInput}"`);
            // Call the agent's core cycle to generate a structured response.
            const agentOutput = await runAgentCycle(userInput);
            return agentOutput; // Return the entire object { response, toolCall }
        } catch (e) {
            // If any part of the agent cycle fails, catch the error.
            error(`Agent core error during chat processing for input "${userInput}":`, e.message);
            // Return a user-friendly error message, wrapped in the expected object structure.
            return {
                response: `An error occurred while processing your request: ${e.message}`,
                toolCall: null
            };
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