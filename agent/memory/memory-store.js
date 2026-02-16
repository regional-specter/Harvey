const fs = require('fs');
const path = require('path');
// Import the schema and validator defined previously.
// Assuming schemas.js is in the same directory, hence './schemas'.
const { ChatMemorySchemaV1, isValidMemoryEntry } = require('./schemas');
const { log, error } = require('../core/logger');

// Define the path to the memory file, relative to this file's location.
const MEMORY_FILE_PATH = path.join(__dirname, 'memory.json');
let memoryEntries = []; // In-memory array to hold all memory entries
let nextId = 1; // Counter to ensure unique IDs for new entries

/**
 * Loads memory entries from the JSON file into memoryEntries.
 * It also determines the next available ID for new entries based on existing data.
 * If the file doesn't exist or is empty/corrupted, it initializes memoryEntries as an empty array.
 * @returns {Promise<Array<object>>} A promise that resolves to the loaded array of memory entries.
 */
async function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE_PATH)) {
      const data = fs.readFileSync(MEMORY_FILE_PATH, 'utf-8');
      // If the file is empty, JSON.parse will throw an error. Handle that case.
      if (data.trim() === '') {
        memoryEntries = [];
      } else {
        memoryEntries = JSON.parse(data);
      }

      // Determine the next ID based on the highest existing ID to ensure uniqueness
      if (memoryEntries.length > 0) {
        // Find the maximum ID among existing entries
        const maxId = memoryEntries.reduce((max, entry) => (entry.id > max ? entry.id : max), 0);
        nextId = maxId + 1;
      } else {
        nextId = 1; // Start from 1 if the file was empty or contained no entries
      }
      log(`Successfully loaded ${memoryEntries.length} memory entries from ${MEMORY_FILE_PATH}. Next ID will be: ${nextId}`);
    } else {
      memoryEntries = [];
      nextId = 1;
      log(`Memory file not found at ${MEMORY_FILE_PATH}. Initializing with an empty memory. Next ID will be: ${nextId}`);
    }
    return memoryEntries;
  } catch (e) {
    error(`Error loading or parsing memory from ${MEMORY_FILE_PATH}:`, e.message);
    // If there's an error (e.g., corrupted file), reset to an empty state to prevent further issues.
    memoryEntries = [];
    nextId = 1;
    log(`Resetting memory due to error. Starting with an empty memory. Next ID will be: ${nextId}`);
    return [];
  }
}

/**
 * Appends a new memory entry to the in-memory store after validation.
 * It automatically assigns a unique ID and the current timestamp.
 * @param {object} entryData - An object containing the data for the new memory entry.
 * Expected keys (from ChatMemorySchemaV1): user_input, llm_response, thematic_scope, event_type, entities.
 * @returns {object|null} The validated and augmented memory entry that was added, or null if validation fails.
 */
function appendMemory(entryData) {
  const timestamp = new Date().toISOString();
  // Construct the full entry object, merging provided data with defaults and generated fields.
  const entry = {
    id: nextId++, // Assign the current nextId and then increment it for the next entry
    timestamp: timestamp,
    user_input: entryData.user_input || '', // Default to empty string if not provided
    llm_response: entryData.llm_response || '', // Default to empty string
    thematic_scope: entryData.thematic_scope || 'general_chat', // Default thematic scope
    event_type: entryData.event_type || 'chat_turn', // Default event type for chat turns
    entities: entryData.entities || [], // Default to an empty array for entities
    context: entryData.context || {},    // Add context, defaulting to an empty object
    // Any other fields from ChatMemorySchemaV1 can be added here if entryData provides them
  };

  // Validate the entry before adding it to memoryEntries.
  // The isValidMemoryEntry function (imported from schemas.js) handles type and presence checks.
  if (!isValidMemoryEntry(entry)) {
    error("Invalid memory entry data provided. Entry not appended:", entryData);
    // Decrement nextId as this ID was not successfully used for a valid entry.
    nextId--;
    return null; // Indicate that the entry was not added.
  }

  memoryEntries.push(entry);
  log(`Appended memory entry ID: ${entry.id} with timestamp: ${entry.timestamp}`);
  return entry; // Return the successfully added entry
}

/**
 * Saves the current in-memory `memoryEntries` array to the JSON file.
 * This function overwrites the existing file with the current state of memory.
 * @returns {Promise<void>}
 */
async function saveMemory() {
  try {
    // Stringify the array to JSON format with indentation for readability.
    const dataToSave = JSON.stringify(memoryEntries, null, 2);
    fs.writeFileSync(MEMORY_FILE_PATH, dataToSave, 'utf-8');
    log(`Successfully saved ${memoryEntries.length} memory entries to ${MEMORY_FILE_PATH}`);
  } catch (e) {
    error(`Error saving memory to ${MEMORY_FILE_PATH}:`, e.message);
    // Depending on the application's needs, you might want to throw this error
    // or implement retry mechanisms. For now, logging is sufficient.
  }
}

/**
 * Returns a read-only copy of the current memory entries.
 * This is useful for displaying memory without allowing direct modification.
 * @returns {Array<object>} A copy of the current memory entries.
 */
function getMemoryEntries() {
  return [...memoryEntries]; // Return a shallow copy to prevent external modification
}

/**
 * Clears all memory entries from the in-memory store and the JSON file.
 * @returns {Promise<void>}
 */
async function clearMemory() {
  try {
    // Reset the in-memory state
    memoryEntries = [];
    nextId = 1;
    
    // Overwrite the persistent file with an empty array
    fs.writeFileSync(MEMORY_FILE_PATH, JSON.stringify([], null, 2), 'utf-8');
    console.log(`Memory file has been cleared: ${MEMORY_FILE_PATH}`);
  } catch (error) {
    console.error(`❌ Error clearing memory file ${MEMORY_FILE_PATH}:`, error.message);
    // Re-throw the error to be handled by the caller
    throw error;
  }
}

// Export the public functions for use by other modules.
module.exports = {
  loadMemory,
  appendMemory,
  saveMemory,
  getMemoryEntries, // Expose getter for accessing memory data
  clearMemory,      // Expose the new clear memory function
};