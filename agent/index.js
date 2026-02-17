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
                const allMemories = getMemoryEntries(); // Get all memories
                let filteredMemories = allMemories; // Start with all memories, then filter

                // --- Argument Parsing for Filters ---
                // Using regex for more robust parsing of quoted strings
                const filterIntentMatch = userInput.match(/--intent\s+"([^"]+)"/);
                const filterEntityMatch = userInput.match(/--entity\s+"([^"]+)"/);

                if (filterIntentMatch) {
                    const intentValue = filterIntentMatch[1];
                    log(`Agent core: Filtering summary by intent: "${intentValue}"`);
                    filteredMemories = filteredMemories.filter(entry => 
                        entry.thematic_scope.toLowerCase().includes(intentValue.toLowerCase())
                    );
                } else if (filterEntityMatch) { // prioritize intent if both are present
                    const entityValue = filterEntityMatch[1];
                    log(`Agent core: Filtering summary by entity: "${entityValue}"`);
                    filteredMemories = filteredMemories.filter(entry => 
                        entry.entities.some(entity => 
                            entity.value.toLowerCase().includes(entityValue.toLowerCase())
                        )
                    );
                }
                // --- End Argument Parsing ---

                // Map over (potentially filtered) memories to truncate llm_response for cleaner display
                const truncatedMemories = filteredMemories.map(entry => { 
                    const MAX_SUMMARY_LENGTH = 150; 
                    let displayResponse = entry.llm_response;
                    if (displayResponse.length > MAX_SUMMARY_LENGTH) {
                        displayResponse = displayResponse.substring(0, MAX_SUMMARY_LENGTH).trim() + "... (truncated)";
                    }
                    return {
                        ...entry, 
                        llm_response: displayResponse 
                    };
                });

                // Stringify the truncated memories for display
                return `--- Memory Summary (${filteredMemories.length} entries) ---\n${JSON.stringify(truncatedMemories, null, 2)}\n----------------------`;
            
            case 'export':
                log("Agent core: Command received - /export");
                try {
                    const memoriesToExport = getMemoryEntries();
                    if (memoriesToExport.length === 0) {
                        return "ℹ️ Memory is empty. Nothing to export.";
                    }

                    let markdownContent = `# Harvey Research Summary\n\n`;

                    for (const entry of memoriesToExport) {
                        const entitiesString = entry.entities.map(e => `\`${e.type}: ${e.value}\``).join(', ') || 'None';
                        
                        markdownContent += `---
                            ### Memory Entry: ${entry.id}

                            - **Timestamp:** ${entry.timestamp}
                            - **Scope:** ${entry.thematic_scope}
                            - **Event:** ${entry.event_type}
                            - **Entities:** ${entitiesString}

                            > **User:** ${entry.user_input}

                            **Agent:**
                            ${entry.llm_response}

                            `;
                    }

                    const timestamp = new Date().toISOString().replace(/:/g, '-').slice(0, 19);
                    const fileName = `harvey_research_${timestamp}.md`;
                    // Save in the project root directory (one level up from 'agent/')
                    const filePath = path.join(__dirname, '..', fileName);

                    fs.writeFileSync(filePath, markdownContent);
                    
                    return `✅ Research summary exported to ${fileName}`;

                } catch (e) {
                    error("Failed to export memory:", e.message);
                    return `❌ Error exporting memory: ${e.message}`;
                }

            case 'clear-mem':
                log("Agent core: Command received - /clear-mem");
                await clearMemory();
                return "Memory has been cleared.";

            default:
                // If the command is not recognized, inform the user.
                return `Unknown command: /${baseCommand}. Type '/help' (not yet implemented) for available commands.`;
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