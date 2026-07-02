const NodeCache = require("node-cache");
const fs = require('fs-extra');
const path = require('path');

// Cache for storing ticket-to-user mappings
// stdTTL: 30 days (2592000 seconds)
const ticketCache = new NodeCache({ stdTTL: 2592000 });

// File path for persistence
const MAPPING_FILE = path.join(__dirname, '../data/ticket_user_mappings.json');

// Flag to ensure loading is complete
let isLoaded = false;

/**
 * Load mappings from file on startup
 */
const loadMappings = async () => {
    try {
        if (await fs.pathExists(MAPPING_FILE)) {
            const content = await fs.readFile(MAPPING_FILE, 'utf8');
            if (content && content.trim().length > 0) {
                const data = JSON.parse(content);
                Object.keys(data).forEach(ticketId => {
                    ticketCache.set(ticketId, data[ticketId]);
                });
                console.log(`✅ Loaded ${Object.keys(data).length} ticket-user mappings from file`);
            } else {
                console.log("ℹ️ Mapping file exists but is empty.");
            }
        } else {
            console.log("ℹ️ No mapping file found. Will create one on next save.");
        }
    } catch (error) {
        console.error("Error loading ticket mappings:", error);
    } finally {
        isLoaded = true;
    }
};

/**
 * Save mappings to file for persistence
 */
const saveMappings = async () => {
    if (!isLoaded) {
        console.warn("⚠️ Attempted to save mappings before load complete. Skipping to avoid data loss.");
        return;
    }
    try {
        const allKeys = ticketCache.keys();
        const mappings = {};
        allKeys.forEach(key => {
            mappings[key] = ticketCache.get(key);
        });
        await fs.ensureDir(path.dirname(MAPPING_FILE));
        await fs.writeJson(MAPPING_FILE, mappings, { spaces: 2 });
    } catch (error) {
        console.error("Error saving ticket mappings:", error);
    }
};

/**
 * Store mapping between ticket ID and Slack user
 * @param {string|number} ticketId - Freshservice ticket ID
 * @param {string} userId - Slack user ID
 * @param {string} channelId - Slack channel ID (for DM)
 * @param {string} ticketType - Type of ticket (domain_lock, password_reset, general, etc.)
 */
const storeMapping = (ticketId, userId, channelId, ticketType = 'general', threadTs = null) => {
    // Determine if this is a sensitive ticket
    const sensitiveTypes = ['domain_lock', 'password_reset'];
    const isSensitive = sensitiveTypes.includes(ticketType);

    const mapping = {
        userId,
        channelId,
        ticketType,
        isSensitive,
        threadTs,
        createdAt: new Date().toISOString()
    };
    ticketCache.set(String(ticketId), mapping);

    // Save to file asynchronously (don't wait)
    saveMappings().catch(err => console.error("Failed to save mappings:", err));

    console.log(`📌 Stored mapping: Ticket ${ticketId} -> User ${userId} (Type: ${ticketType}, Sensitive: ${isSensitive})`);
};

/**
 * Get Slack user info from ticket ID
 * @param {string|number} ticketId - Freshservice ticket ID
 * @returns {object|null} - { userId, channelId, createdAt } or null
 */
const getMapping = (ticketId) => {
    return ticketCache.get(String(ticketId)) || null;
};
/**
 * Get ticket mapping from thread timestamp
 * @param {string} threadTs - Slack thread timestamp
 * @returns {object|null} - { ticketId, userId, channelId, ticketType, isSensitive, threadTs } or null
 */
const getMappingByThreadTs = (threadTs) => {
    if (!threadTs) return null;
    const allKeys = ticketCache.keys();
    for (const key of allKeys) {
        const mapping = ticketCache.get(key);
        if (mapping && mapping.threadTs === threadTs) {
            return {
                ticketId: key,
                ...mapping
            };
        }
    }
    return null;
};

/**
 * Remove mapping (optional cleanup)
 * @param {string|number} ticketId - Freshservice ticket ID
 */
const removeMapping = (ticketId) => {
    ticketCache.del(String(ticketId));
    saveMappings().catch(err => console.error("Failed to save mappings:", err));
};

// Load mappings on module initialization
loadMappings();

module.exports = {
    storeMapping,
    getMapping,
    getMappingByThreadTs,
    removeMapping
};
