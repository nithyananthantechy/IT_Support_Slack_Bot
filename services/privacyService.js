const fs = require('fs-extra');
const path = require('path');

const PRIVACY_CONFIG_FILE = path.join(__dirname, '../data/privacy_config.json');

// Default privacy configurations
let config = {
    redactPII: true,
    forceLocalOllamaForDMs: true,
    redactedFields: ['email', 'phone', 'ip']
};

const loadConfig = async () => {
    try {
        await fs.ensureDir(path.dirname(PRIVACY_CONFIG_FILE));
        if (await fs.pathExists(PRIVACY_CONFIG_FILE)) {
            config = await fs.readJson(PRIVACY_CONFIG_FILE);
        } else {
            await fs.writeJson(PRIVACY_CONFIG_FILE, config, { spaces: 2 });
        }
    } catch (e) {
        console.error("Error loading privacy config:", e);
    }
};

const saveConfig = async (newConfig) => {
    config = { ...config, ...newConfig };
    await fs.writeJson(PRIVACY_CONFIG_FILE, config, { spaces: 2 });
};

/**
 * Redact sensitive PII (emails, phone numbers, IP addresses) from text
 */
const redact = (text) => {
    if (!config.redactPII || !text) return text;

    let redacted = text;
    // Email regex
    if (config.redactedFields.includes('email')) {
        redacted = redacted.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]');
    }
    // Phone number regex
    if (config.redactedFields.includes('phone')) {
        redacted = redacted.replace(/(?:\+?\d{1,3}[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}/g, '[PHONE_REDACTED]');
    }
    // IP Address regex
    if (config.redactedFields.includes('ip')) {
        redacted = redacted.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP_REDACTED]');
    }

    return redacted;
};

const getPrivacyConfig = () => config;

// Load immediately on initialization
loadConfig();

module.exports = {
    redact,
    getPrivacyConfig,
    saveConfig
};
