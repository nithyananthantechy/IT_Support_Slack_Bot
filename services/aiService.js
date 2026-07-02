const { GoogleGenerativeAI } = require("@google/generative-ai");
const OpenAI = require("openai");
const config = require("../config/ai");
const privacyService = require("./privacyService");

// Initialize Gemini
let geminiModel;
if (config.gemini.apiKey) {
    const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    geminiModel = genAI.getGenerativeModel({ model: config.gemini.model });
}

// Initialize OpenAI
let openai;
if (config.openai.apiKey && config.openai.apiKey !== 'your-openai-api-key') {
    openai = new OpenAI({
        apiKey: config.openai.apiKey,
        timeout: 30 * 1000,
        maxRetries: 2
    });
}

// Initialize Ollama
let ollama;
if (config.ollama.baseUrl) {
    ollama = new OpenAI({
        apiKey: 'ollama',
        baseURL: `${config.ollama.baseUrl}/v1`,
        timeout: 60 * 1000,
        maxRetries: 1
    });
}

const fallbackDetectIntent = (text) => {
    const lowerText = text.toLowerCase();

    // Quick Ticket logic
    if (lowerText.includes('domain lock') || lowerText.includes('domainlocked')) {
        return { issue_type: "domain_lock", action: "quick_ticket", needs_troubleshooting: false };
    }
    if (lowerText.includes('password reset')) {
        return { issue_type: "password_reset", action: "quick_ticket", needs_troubleshooting: false };
    }
    if (lowerText.includes('new biometric') || lowerText.includes('request biometric') || lowerText.includes('biometric access')) {
        return { issue_type: "biometric", action: "quick_ticket", needs_troubleshooting: false };
    }

    // Troubleshooting logic
    const isTrouble = lowerText.includes('issue') || lowerText.includes('problem') || lowerText.includes('error') ||
        lowerText.includes('not working') || lowerText.includes('slow') || lowerText.includes('weird') ||
        lowerText.includes('help') || lowerText.includes('broken');

    if (isTrouble) {
        let type = "general";
        if (lowerText.includes('net') || lowerText.includes('wifi') || lowerText.includes('internet')) type = "network";
        if (lowerText.includes('mouse') || lowerText.includes('keyboard')) type = "hardware";
        return { action: "troubleshoot", needs_troubleshooting: true, issue_type: type };
    }

    // Greeting logic
    if (lowerText.startsWith('hi') || lowerText.startsWith('hello') || lowerText.startsWith('hey') ||
        lowerText.startsWith('morning') || lowerText.startsWith('evening')) {
        // Only if message is short (prevents matching technical issues starting with greeting)
        if (lowerText.split(/\s+/).length <= 4) {
            console.log(`⚡ Fallback greeting match: "${lowerText}"`);
            return { action: "answer", direct_answer: "Hello! I'm your IT Helpdesk Assistant. How can I help you today?", needs_troubleshooting: false };
        }
    }

    return { action: "answer", direct_answer: "I'm here to help with IT issues. What's on your mind?", needs_troubleshooting: false };
};

const detectIntent = async (userMessage, options = {}) => {
    // PII Redaction
    const redactedMessage = privacyService.redact(userMessage);

    // 1. FAST GREETING check
    const lowerText = redactedMessage.trim().toLowerCase();
    const greetings = ['hi', 'hello', 'hey', 'yo', 'morning', 'afternoon', 'evening', 'hola'];
    const words = lowerText.split(/\s+/);

    // Check if message starts with a greeting word and is short (max 4 words)
    if (greetings.includes(words[0]) && words.length <= 4) {
        console.log(`⚡ Fast-path greeting match: "${words[0]}"`);
        return {
            action: "answer",
            direct_answer: "Hello! I'm your IT Helpdesk Assistant. I can help you troubleshoot technical issues or create a support ticket. What can I do for you today?",
            needs_troubleshooting: false
        };
    }

    // 1.5 FAST BIOMETRIC REQUEST check
    const isBiometricRequest = lowerText.includes('new biometric') || lowerText.includes('request biometric') ||
        lowerText.includes('biometric access') || lowerText.includes('biometric request');
    if (isBiometricRequest && words.length <= 6) {
        console.log(`⚡ Fast-path biometric request match: "${lowerText}"`);
        return {
            action: "quick_ticket",
            issue_type: "biometric",
            needs_troubleshooting: false
        };
    }

    // 2. Full IT Assistant Prompt
    const prompt = `
You are a concierge IT helpdesk assistant. Analyze: "${redactedMessage}"
Provide JSON ONLY. DO NOT return any other text or explanation. Use this EXACT schema:
{
  "issue_type": "network/printer/password/software/hardware/email/vpn/biometric/freshservice/domain_lock/password_reset/general_question",
  "needs_troubleshooting": true,
  "urgency": "medium",
  "suggested_article": null,
  "direct_answer": "friendly response",
  "action": "create_ticket/troubleshoot/answer/quick_ticket"
}
Rules:
- If user mentions "domain lock", "password reset", or "new biometric access" specifically, action="quick_ticket".
- If user asks to "create a ticket/raise issue/human", action="create_ticket".
- Shorthand: "net" -> "network", "syn" -> "sync issues", "drive" -> "software", "mouse" -> "mouse", "bio" -> "biometric".
- If user describes a problem (like "net issue" or "biometric not working"), action="troubleshoot" and needs_troubleshooting=true.
- If the user is asking "who are you", explain you are an IT Helpdesk Bot.
`;

    // Privacy Routing: Force Ollama for DM/IM if configured
    const privacyCfg = privacyService.getPrivacyConfig();
    let priorityProviders = config.priority;
    if (options.isDM && privacyCfg.forceLocalOllamaForDMs) {
        console.log("🔒 Privacy Mode: Routing private DM conversation to local Ollama.");
        priorityProviders = ['ollama'];
    }

    for (const provider of priorityProviders) {
        try {
            let jsonString;
            let timeoutId;
            const timeoutDuration = provider === 'ollama' ? 30000 : 15000;
            const timeoutPromise = new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error(`${provider} Timeout`)), timeoutDuration);
            });

            try {
                if (provider === 'ollama' && ollama) {
                    const completion = await Promise.race([
                        ollama.chat.completions.create({
                            messages: [
                                { role: "system", content: "You are an IT helpdesk bot. JSON ONLY." },
                                { role: "user", content: `[INST] Analyze: "${redactedMessage}". JSON ONLY. [/INST]` }
                            ],
                            model: config.ollama.model
                        }),
                        timeoutPromise
                    ]);
                    jsonString = completion.choices[0].message.content;
                } else if (provider === 'openai' && openai) {
                    const completion = await Promise.race([
                        openai.chat.completions.create({
                            messages: [
                                { role: "system", content: "You are an IT helpdesk bot. JSON ONLY." },
                                { role: "user", content: prompt }
                            ],
                            model: config.openai.model
                        }),
                        timeoutPromise
                    ]);
                    jsonString = completion.choices[0].message.content;
                } else if (provider === 'gemini' && geminiModel) {
                    const result = await Promise.race([
                        geminiModel.generateContent(prompt),
                        timeoutPromise
                    ]);
                    jsonString = result.response.text();
                } else {
                    clearTimeout(timeoutId);
                    continue;
                }
            } finally {
                clearTimeout(timeoutId);
            }

            const match = jsonString.match(/\{[\s\S]*\}/);
            if (!match) throw new Error("No JSON found in response");

            const parsed = JSON.parse(match[0]);
            console.log(`PARSED ${provider.toUpperCase()} INTENT:`, parsed);
            return parsed;
        } catch (e) {
            console.error(`${provider} intent failed:`, e.message);
        }
    }
    return fallbackDetectIntent(redactedMessage);
};

const generateDynamicSteps = async (issueDescription, forceFallback = false, options = {}) => {
    const redactedIssue = privacyService.redact(issueDescription);

    const getFallbackSteps = (desc) => {
        const lower = desc.toLowerCase();
        if (lower.includes('mouse')) {
            return [
                { instruction: "*Check Connection*\n• Unplug and replug the mouse.\n_Expected: Connected._" },
                { instruction: "*Try Port*\n• Use a different USB port.\n_Expected: Port ruled out._" },
                { instruction: "*Check Battery*\n• If wireless, replace batteries.\n_Expected: Power confirmed._" },
                { instruction: "*Update Driver*\n• Check Device Manager for updates.\n_Expected: Softare ruled out._" },
                { instruction: "*Test Surface*\n• Try on a khác surface or mouse pad.\n_Expected: Resolved._" }
            ];
        }
        return [
            { instruction: "*Restart System*\n• Reboot your computer.\n_Expected: Errors cleared._" },
            { instruction: "*Check Cables*\n• Ensure all physical connections are tight.\n_Expected: Secure connection._" },
            { instruction: "*Check Internet*\n• Verify your WiFi or Ethernet signal.\n_Expected: Online status._" },
            { instruction: "*Clear Cache*\n• Delete temporary files or browser data.\n_Expected: Conflict removed._" },
            { instruction: "*Contact Helpdesk*\n• If failed, we will raise a ticket.\n_Expected: Ticket created._" }
        ];
    };

    if (forceFallback) return getFallbackSteps(redactedIssue);

    const privacyCfg = privacyService.getPrivacyConfig();
    let priorityProviders = config.priority;
    if (options.isDM && privacyCfg.forceLocalOllamaForDMs) {
        priorityProviders = ['ollama'];
    }

    for (const provider of priorityProviders) {
        try {
            let jsonString;
            const prompt = `Generate 5 structured IT troubleshooting steps for: "${redactedIssue}". Return ONLY a JSON array of 5 objects with "title", "actions" (array), and "expected_result".`;

            if (provider === 'ollama' && ollama) {
                const completion = await ollama.chat.completions.create({
                    messages: [{ role: "user", content: `[INST] ${prompt} [/INST]` }],
                    model: config.ollama.model
                });
                jsonString = completion.choices[0].message.content;
            } else if (provider === 'gemini' && geminiModel) {
                const result = await geminiModel.generateContent(prompt);
                jsonString = result.response.text();
            } else continue;

            const match = jsonString.match(/\[[\s\S]*\]/);
            if (!match) throw new Error("No JSON array found");
            const parsed = JSON.parse(match[0]);

            return parsed.slice(0, 5).map(s => ({
                instruction: `*${s.title || "Step"}*\n${(s.actions || []).map(a => `• ${a}`).join('\n')}\n_Expected: ${s.expected_result || ""}_`
            }));
        } catch (e) {
            console.error(`${provider} steps failed:`, e.message);
        }
    }
    return getFallbackSteps(redactedIssue);
};

const generateResponse = async (userMessage, history, options = {}) => {
    const redactedMessage = privacyService.redact(userMessage);
    const redactedHistory = history.map(h => ({
        role: h.role,
        content: privacyService.redact(h.content)
    }));

    const privacyCfg = privacyService.getPrivacyConfig();
    let priorityProviders = config.priority;
    if (options.isDM && privacyCfg.forceLocalOllamaForDMs) {
        priorityProviders = ['ollama'];
    }

    for (const provider of priorityProviders) {
        try {
            if (provider === 'ollama' && ollama) {
                const completion = await ollama.chat.completions.create({
                    messages: [{ role: "system", content: "You are a friendly IT assistant." }, ...redactedHistory, { role: "user", content: redactedMessage }],
                    model: config.ollama.model
                });
                return completion.choices[0].message.content;
            }
        } catch (e) { }
    }
    return "I'm having trouble with my AI right now. How can I help you?";
};

module.exports = { detectIntent, generateDynamicSteps, generateResponse };
