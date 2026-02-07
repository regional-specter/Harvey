/*
     * `MemorySchemaV1` fields:
          * id: Unique identifier for the memory.
          * timestamp: When the memory was created.
          * thematic_scope: The user's research goal (e.g., "long-term investing in AAPL",
            "risk analysis of TSLA").
          * event_type: What kind of action happened (e.g., "research pass", "summary
            generation").
          * entities: Key entities extracted (e.g., [{ type: "stock", value: "AAPL" }, {
            type: "macro", value: "inflation" }]).
          * summary: A summary of the research pass.
          * raw_llm_output: The raw text output from the LLM research pass (for
            debugging/traceability).
          * source_url: URL of the source if applicable.

*/

export const ChatMemorySchemaV1 = {
  // Using a simple counter for ID for now, can be replaced with UUID later.
  // The actual ID will be generated when creating an entry.
  id: 'number',
  timestamp: 'string', // ISO 8601 format, e.g., "2024-02-07T10:30:00.000Z"
  user_input: 'string',
  llm_response: 'string',
  thematic_scope: 'string', // e.g., 'general_chat', 'research_topic_X'
  event_type: 'string', // e.g., 'chat_turn', 'research_pass'
  entities: 'array', // e.g., [{ type: 'stock', value: 'AAPL' }]
};

// A simple validator function (optional for v0.1, but good practice)
export function isValidMemoryEntry(entry) {
  if (!entry) return false;

  // Basic checks for required fields and types
  if (typeof entry.id !== 'number' ||
      typeof entry.timestamp !== 'string' ||
      typeof entry.user_input !== 'string' ||
      typeof entry.llm_response !== 'string' ||
      typeof entry.thematic_scope !== 'string' ||
      typeof entry.event_type !== 'string' ||
      !Array.isArray(entry.entities)) {
    console.error('Invalid memory entry structure:', entry);
    return false;
  }

  return true;
}
