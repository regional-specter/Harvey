// agent/memory/memory-retriever.js

// Import getMemoryEntries to access the full memory store
const { getMemoryEntries } = require('./memory-store');

/**
 * Retrieves relevant memories based on the current intent (thematic scope and entities).
 * This is a basic, rule-based retriever for the beta version, without using embeddings.
 *
 * @param {object} currentIntent - An object containing thematic_scope and entities of the current user query.
 *                                 e.g., { thematic_scope: 'stock valuation', entities: [{type: 'STOCK_TICKER', value: 'AAPL'}] }
 * @param {number} [limit=3] - The maximum number of relevant memories to return.
 * @returns {Array<object>} An array of relevant memory entries, sorted by timestamp (oldest first).
 */
function retrieveRelevantMemories(currentIntent, limit = 3) {
    // Basic validation for the current intent
    if (!currentIntent || (!currentIntent.thematic_scope && (!currentIntent.entities || currentIntent.entities.length === 0))) {
        console.warn("Retriever: No meaningful intent provided. Returning empty memories.");
        return [];
    }

    const allMemories = getMemoryEntries(); // Get all stored memories
    let relevantMemories = [];

    // Extract and normalize current intent values for easier comparison
    const currentScope = currentIntent.thematic_scope ? currentIntent.thematic_scope.toLowerCase() : '';
    const currentEntityValues = currentIntent.entities
        ? currentIntent.entities.map(e => e.value.toLowerCase())
        : [];

    // Iterate through all stored memories to find relevant ones
    for (const memory of allMemories) {
        let isRelevant = false;

        // 1. Check for thematic scope match
        if (currentScope && memory.thematic_scope && memory.thematic_scope.toLowerCase() === currentScope) {
            isRelevant = true;
        }

        // 2. Check for entity overlap (if not already found relevant by scope)
        if (!isRelevant && currentEntityValues.length > 0 && memory.entities && memory.entities.length > 0) {
            const memoryEntityValues = memory.entities.map(e => e.value.toLowerCase());
            // Check if any entity from the current query is present in the memory's entities
            for (const currentVal of currentEntityValues) {
                if (memoryEntityValues.includes(currentVal)) {
                    isRelevant = true;
                    break; // Found a relevant entity, no need to check others for this memory
                }
            }
        }

        if (isRelevant) {
            relevantMemories.push(memory);
        }
    }

    // Sort relevant memories by timestamp (oldest first) to maintain chronological order in context
    relevantMemories.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Return only the most recent 'limit' relevant memories
    // .slice(-limit) gets the last 'limit' elements from the sorted array
    const latestRelevantMemories = relevantMemories.slice(-limit);
    
    console.log(`Retriever: Found ${latestRelevantMemories.length} relevant memories for scope "${currentScope}" and entities [${currentEntityValues.join(', ')}]`);
    return latestRelevantMemories;
}

module.exports = {
    retrieveRelevantMemories,
};