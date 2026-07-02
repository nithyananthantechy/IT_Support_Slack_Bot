const { App } = require('@slack/bolt');
const fs = require('fs');
fs.appendFileSync('startup.log', `[${new Date().toISOString()}] Bot application started/reloaded\n`);
const config = require('./config/slack');
const aiConfig = require('./config/ai');
const adminConfig = require('./config/admin-users');
const aiService = require('./services/aiService');
const knowledgeBase = require('./services/knowledgeBase');
const conversationManager = require('./services/conversationManager');
const freshservice = require('./services/freshservice');
const appHomeView = require('./views/appHome');
const modalViews = require('./views/modals');
const messageViews = require('./views/messages');

// Initialize App
const app = new App({
    token: config.slackBotToken,
    signingSecret: config.slackSigningSecret,
    socketMode: true,
    appToken: config.slackAppToken,
    port: config.port
});

let botUserId = null;

// --- Debug Logging ---
app.use(async ({ body, next }) => {
    const logMsg = `[${new Date().toISOString()}] RECEIVED: ${JSON.stringify(body, null, 2)}\n`;
    fs.appendFileSync('debug_events.log', logMsg);

    if (body.type === 'event_callback') {
        console.log('--- EVENT TYPE:', body.event.type, '---');
        if (body.event.type === 'message') {
            console.log('RAW MESSAGE:', JSON.stringify(body.event, null, 2));
        }
    }
    await next();
});

// Start App & Check Identity
(async () => {
    try {
        const auth = await app.client.auth.test();
        botUserId = auth.user_id;
        console.log(`✅ Bot is online: ${auth.user} (ID: ${botUserId}) on Team: ${auth.team}`);
        await app.start();
        logProcess(`⚡️ Slack Helpdesk Bot started and listening (BotID: ${botUserId})`);
        console.log('⚡️ Slack Helpdesk Bot is running!');
    } catch (error) {
        console.error('❌ Failed to start bot:', error);
    }
})();

// Load Knowledge Base
(async () => {
    await knowledgeBase.loadArticles();
})();

// --- Logging Utility ---
const logProcess = (msg) => {
    fs.appendFileSync('debug_events.log', `[${new Date().toISOString()}] PROCESS: ${msg}\n`);
};

// --- Event Handlers ---

// --- Shared Logic ---

/**
 * Shared message processing logic for DMs and Channel Mentions
 */
async function processMessage(text, userId, channelId, say, client, logger, cachedIntent = null) {
    // Helper for channel-aware responses
    const isDM = channelId.startsWith('D'); // DMs usually start with D, but using channel_type is better if available.
    // However, channelId is passed from app_mention (C...) or app.message (D...).

    const smartSay = async (args) => {
        try {
            if (typeof args === 'string') args = { text: args };
            if (isDM) {
                return await say(args);
            } else {
                // In channels, use Ephemeral messages for privacy
                return await client.chat.postEphemeral({
                    channel: channelId,
                    user: userId,
                    ...args
                });
            }
        } catch (err) {
            console.error("Error in smartSay:", err);
            // Fallback to regular say if ephemeral fails
            try {
                return await say(args);
            } catch (err2) {
                console.error("Final fallback say failed:", err2);
            }
        }
    };

    try {
        logProcess(`Processing message from ${userId} in ${channelId}: "${text}"`);
        const state = conversationManager.getConversationState(userId);

        // --- 0. Handle Data Gathering States ---

        // Quick Ticket Flow (Domain Lock, Password Reset) - Only needs Employee ID
        if (state.state === 'AWAITING_EMP_ID_QUICK') {
            const empId = text.trim();
            logProcess(`Gathered Employee ID for quick ticket: ${empId}`);

            const pendingData = { ...state.pendingTicketData, empId };
            // Quick tickets skip hostname, go straight to finalization
            return await finalizeTicket(pendingData, userId, channelId, smartSay, say, client);
        }

        // Regular Ticket Flow
        if (state.state === 'AWAITING_EMP_ID') {
            const empId = text.trim();
            logProcess(`Gathered Employee ID: ${empId}`);

            const pendingData = { ...state.pendingTicketData, empId };

            // Check if we also need Hostname (Non-biometric system issues)
            if (pendingData.type !== 'biometric') {
                conversationManager.updateConversationState(userId, {
                    state: 'AWAITING_HOSTNAME',
                    pendingTicketData: pendingData
                });
                await smartSay({
                    text: "Got it. Now, could you please provide your *System Hostname*? \n\n_Tip: To find it, type `hostname` in your terminal/command prompt or check the sticker on your machine._"
                });
                return;
            } else {
                // Biometric only needs Emp ID
                return await finalizeTicket(pendingData, userId, channelId, smartSay, say, client);
            }
        }

        if (state.state === 'AWAITING_HOSTNAME') {
            const hostname = text.trim();
            logProcess(`Gathered Hostname: ${hostname}`);

            const pendingData = { ...state.pendingTicketData, hostname };
            return await finalizeTicket(pendingData, userId, channelId, smartSay, say, client);
        }

        // 0.5 INSTANT KNOWLEDGE BASE MATCH (Prioritize speed for known issues)
        // Skip for "new" requests or "tickets" to allow AI to handle them as Quick Tickets
        const isRequest = text.toLowerCase().includes('new') || text.toLowerCase().includes('request') ||
            text.toLowerCase().includes('ticket') || text.toLowerCase().includes('raise');

        const article = isRequest ? null : knowledgeBase.findArticle(text);
        if (article && article.steps && article.steps.length > 0) {
            console.log(`✅ Instant KB Match found: ${article.title}`);
            conversationManager.updateConversationState(userId, {
                step: 1,
                currentArticle: article,
                ticketCreated: false,
                attempts: 0
            });

            const firstStep = article.steps[0];
            await smartSay({
                text: `I can help with that! Let's troubleshoot this.`,
                blocks: messageViews.troubleshootingStep(firstStep.instruction, 1, article.steps.length, article.id)
            });
            return;
        }

        // 1. Detect Intent (skip if passed from proactive check)
        const intent = cachedIntent || await aiService.detectIntent(text, { isDM });
        logProcess(`Intent detected: ${JSON.stringify(intent)}`);

        // 2. Handle specific actions
        const isQuickTicket = intent.action === 'quick_ticket';
        const isTicketRequest = text.toLowerCase().includes('ticket') || text.toLowerCase().includes('raise') || intent.action === 'create_ticket';

        if (isQuickTicket) {
            // Quick ticket flow: Only ask for Employee ID (skip hostname)
            const ticketType = intent.issue_type; // domain_lock or password_reset
            conversationManager.updateConversationState(userId, {
                state: 'AWAITING_EMP_ID_QUICK',
                pendingTicketData: {
                    subject: '', // Will be formatted in finalizeTicket
                    description: `User request: ${text}`,
                    type: ticketType,
                    originalText: text,
                    isQuickTicket: true
                }
            });

            const ticketTypeName = ticketType === 'domain_lock' ? 'Domain Lock' :
                ticketType === 'password_reset' ? 'Password Reset' : 'Biometric Access';
            await smartSay({
                text: `I'll help you raise a ${ticketTypeName} request. Please provide your **Employee ID**:`
            });
            return;
        }

        if (intent.action === 'answer' && intent.direct_answer) {
            await smartSay({ text: intent.direct_answer });
            const analyticsService = require('./services/analyticsService');
            analyticsService.logDeflection(userId, 'direct_answer', 'direct_answer').catch(err => console.error(err));
            return;
        }

        if (isTicketRequest) {
            // Initiate data gathering flow instead of immediate creation
            conversationManager.updateConversationState(userId, {
                state: 'AWAITING_EMP_ID',
                pendingTicketData: {
                    subject: `Support Request: ${intent.issue_type || 'General'}`,
                    description: `User message: ${text}`,
                    type: intent.issue_type,
                    originalText: text
                }
            });

            await smartSay({
                text: `I'll help you raise a ticket for that. First, could you please provide your **Employee ID**?`
            });
            return;
        }

        // 3. Handle troubleshooting
        if (intent.needs_troubleshooting || intent.action === 'troubleshoot' || (!intent.direct_answer && !isTicketRequest)) {
            let article = null;

            try {
                // Step 1: SEARCH BY ISSUE TYPE FROM AI (Original text check already done at top)
                if (intent.issue_type) {
                    console.log(`🔍 Step 2: Searching by issue_type: "${intent.issue_type}"`);
                    article = knowledgeBase.findArticle(intent.issue_type);
                }

                // Step 3: Check if AI specifically suggested an article
                if (!article && intent.suggested_article) {
                    console.log(`🔍 Step 3: Searching by suggested article: "${intent.suggested_article}"`);
                    const specificArticle = knowledgeBase.getAllArticles().find(a =>
                        a.title.toLowerCase().includes(intent.suggested_article.toLowerCase()) ||
                        a.id.includes(intent.suggested_article)
                    );
                    if (specificArticle) {
                        article = specificArticle;
                        console.log(`✅ Using specific article: ${specificArticle.title}`);
                    }
                }

                // If article found, use it
                if (article && article.steps && article.steps.length > 0) {
                    console.log(`✅ Found article: ${article.title} with ${article.steps.length} steps`);
                    conversationManager.updateConversationState(userId, {
                        step: 1,
                        currentArticle: article,
                        ticketCreated: false,
                        attempts: 0
                    });

                    const step = article.steps[0];
                    await smartSay({
                        text: `I can help with that! Let's troubleshoot this.`,
                        blocks: messageViews.troubleshootingStep(step.instruction, 1, article.steps.length, article.id)
                    });
                    return;
                }

                // If no article found, generate AI-specific steps
                console.log(`ℹ️ No article found. Generating AI-specific steps...`);
                await smartSay({
                    text: "Troubleshooting Steps",
                    blocks: [
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": "Let me generate specific troubleshooting steps for your issue..."
                            }
                        }
                    ]
                });

                // Add a timeout to the AI generation
                let dynamicSteps;
                try {
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('AI Generation Timeout')), 15000)
                    );
                    dynamicSteps = await Promise.race([
                        aiService.generateDynamicSteps(text, false, { isDM }),
                        timeoutPromise
                    ]);
                } catch (error) {
                    console.error("⚠️ Dynamic steps failed or timed out:", error.message);
                    dynamicSteps = await aiService.generateDynamicSteps(text, true, { isDM }); // Force fallback
                }

                if (dynamicSteps && dynamicSteps.length > 0) {
                    article = {
                        id: `dynamic_${Date.now()}`,
                        title: `Help: ${text.slice(0, 50)}`,
                        steps: dynamicSteps
                    };
                    console.log(`✅ Generated ${dynamicSteps.length} AI-specific steps`);

                    conversationManager.updateConversationState(userId, {
                        step: 1,
                        currentArticle: article,
                        ticketCreated: false,
                        attempts: 0
                    });

                    const step = article.steps[0];
                    await smartSay({
                        text: `I can help with that! Let's troubleshoot this.`,
                        blocks: messageViews.troubleshootingStep(step.instruction, 1, article.steps.length, article.id)
                    });
                    return;
                } else {
                    // Final fallback: Create ticket if no steps generated
                    console.log(`⚠️ Could not generate steps. Offering ticket creation.`);
                    conversationManager.updateConversationState(userId, {
                        state: 'AWAITING_EMP_ID',
                        pendingTicketData: {
                            subject: `Issue: ${text.slice(0, 50)}`,
                            description: `User request: ${text}`,
                            type: 'General',
                            originalText: text
                        }
                    });

                    await smartSay({
                        text: "I couldn't generate troubleshooting steps for this issue. I'll help you raise a ticket instead. Please provide your **Employee ID**:"
                    });
                    return;
                }
            } catch (error) {
                console.error("❌ Error in troubleshooting flow:", error);
                await smartSay({
                    text: "I encountered an error while processing your request. Please try again or type 'create ticket' to raise a support ticket."
                });
                return;
            }
        } else {
            // Direct Answer
            let response;
            if (intent.direct_answer) {
                response = intent.direct_answer;
            } else {
                response = await aiService.generateResponse(text, conversationManager.getConversationState(userId).history, { isDM });
            }
            await smartSay({
                text: response,
                blocks: [
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": response
                        }
                    },
                    {
                        "type": "actions",
                        "elements": [
                            {
                                "type": "button",
                                "text": {
                                    "type": "plain_text",
                                    "text": "🎫 Still need help? Raise a Ticket",
                                    "emoji": true
                                },
                                "action_id": "report_issue"
                            }
                        ]
                    }
                ]
            });
        }

        // Update history
        conversationManager.addMessageToHistory(userId, 'user', text);
    } catch (error) {
        logger.error("Error processing message:", error);
        await smartSay({
            text: "I'm sorry, I encountered an unexpected error while processing your request. I'll notify our IT team."
        });
    }
}

/**
 * Finalize ticket creation after gathering all data
 */
async function finalizeTicket(data, userId, channelId, smartSay, say, client) {
    try {
        // Fetch user info from Slack
        let requesterName = "Unknown User";
        let requesterEmail = "user@example.com";
        try {
            const userInfo = await client.users.info({ user: userId });
            if (userInfo.ok) {
                requesterName = userInfo.user.real_name || userInfo.user.name;
                requesterEmail = userInfo.user.profile.email || requesterEmail;
            }
        } catch (err) {
            console.error("Error fetching user info:", err);
        }

        // Format subject based on ticket type
        let ticketSubject;
        let l2Group = 'SysAdmin';
        let severity = 'Medium';
        let structuredSummary = '';

        // Get conversation history to pass to classifier
        const conversationManager = require('./services/conversationManager');
        const convoState = conversationManager.getConversationState(userId);
        const historyText = (convoState.history || [])
            .map(h => `${h.role === 'user' ? 'Employee' : 'Bot'}: ${h.content}`)
            .join('\n');

        if (data.isQuickTicket) {
            // Quick tickets: "Domain Lock - EMP123", "Password Reset - EMP123", or "Biometric Access - EMP123"
            const ticketTypeName = data.type === 'domain_lock' ? 'Domain Lock' :
                data.type === 'password_reset' ? 'Password Reset' : 'Biometric Access';
            ticketSubject = `${ticketTypeName} - ${data.empId}`;
            
            // Preset routing for quick tickets
            if (data.type === 'domain_lock' || data.type === 'password_reset') {
                l2Group = 'SecOps';
            } else if (data.type === 'biometric') {
                l2Group = 'Hardware';
            }
        } else {
            // Regular tickets: Keep existing format + perform L2 AI Classification
            ticketSubject = data.subject;
            
            try {
                const aiService = require('./services/aiService');
                const classification = await aiService.classifyL2Ticket(historyText || data.description);
                if (classification) {
                    l2Group = classification.l2_group || l2Group;
                    severity = classification.priority || severity;
                    structuredSummary = classification.structured_summary || '';
                }
            } catch (err) {
                console.error("Failed to run L2 classification, falling back to default routing:", err);
            }
        }

        let ticketDescription = `
User Data:
- Employee ID: ${data.empId}
- System Hostname: ${data.hostname || 'N/A (Quick Ticket or Biometric Issue)'}

Original Issue:
${data.description}
        `.trim();

        if (structuredSummary) {
            ticketDescription += `\n\nL1 Diagnostic Summary:\n${structuredSummary}`;
        }
        ticketDescription += `\n\nAssigned L2 Queue: ${l2Group}\nPriority: ${severity}`;

        const ticket = await freshservice.createTicket({
            subject: ticketSubject,
            description: ticketDescription,
            email: requesterEmail,
            name: requesterName
        });

        // Use say (public) for ticket confirmation so team knows
        const result = await say({
            channel: channelId,
            text: `Support ticket #${ticket.id} created successfully.`,
            blocks: messageViews.ticketCreated(ticket.id)
        });

        // Store ticket-user mapping with thread timestamp for webhook notifications
        const ticketUserMap = require('./services/ticketUserMap');
        ticketUserMap.storeMapping(ticket.id, userId, channelId, data.type || 'general', result ? result.ts : null);

        // Log ticket to analytics
        const analyticsService = require('./services/analyticsService');
        analyticsService.logTicket(ticket.id, userId, data.type || 'general').catch(err => console.error(err));

        // Clear state
        conversationManager.clearConversationState(userId);
    } catch (error) {
        console.error("Error finalizing ticket:", error);
        await smartSay("I'm sorry, I encountered an error while finalizing your ticket. Please try again or contact IT support.");
    }
}

// --- Event Handlers ---

// App Home Opened
app.event('app_home_opened', async ({ event, client, logger }) => {
    try {
        const homeView = appHomeView.createAppHomeView(event.user, "User");
        await client.views.publish({
            user_id: event.user,
            view: homeView
        });
    } catch (error) {
        logger.error(error);
    }
});

// Helper to clean mentions and check if bot was tagged
function getMessageInfo(text) {
    if (!text) return { cleanedText: "", isMentioned: false };

    // Clean Slack HTML entities (e.g., &gt; for >)
    let processedText = text.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');

    // Remove Slack blockquote prefix "> " if present
    processedText = processedText.replace(/^>\s*/, '');

    if (!botUserId) return { cleanedText: processedText.trim(), isMentioned: false };

    const botMentionRegex = new RegExp(`<@${botUserId}>`, 'g');
    const isMentioned = botMentionRegex.test(processedText);
    const cleanedText = processedText.replace(botMentionRegex, '').trim();

    return { cleanedText, isMentioned };
}

// App Mention Context (Channels)
app.event('app_mention', async ({ event, say, client, logger }) => {
    logProcess(`app_mention triggered! Text: ${event.text}`);
    const { cleanedText } = getMessageInfo(event.text);
    // Add a flag to the event to signal it's handled (useful if combined with message event)
    event.is_handled_as_mention = true;
    await processMessage(cleanedText, event.user, event.channel, say, client, logger);
});

// Message Context (DMs and Proactive Channels)
app.message(async ({ message, say, client, logger }) => {
    logProcess(`app.message triggered! Channel: ${message.channel}, Type: ${message.channel_type}, BotID: ${message.bot_id}`);
    console.log(`DEBUG: app.message triggered! Channel: ${message.channel}, Type: ${message.channel_type}, BotID: ${message.bot_id}`);

    // Ignore bot messages
    if (message.bot_id) return;

    // Check if this is a reply in a thread associated with a ticket
    if (message.thread_ts) {
        const ticketUserMap = require('./services/ticketUserMap');
        const mapping = ticketUserMap.getMappingByThreadTs(message.thread_ts);
        if (mapping) {
            console.log(`💬 Detected reply in ticket thread. Thread: ${message.thread_ts}, Ticket ID: ${mapping.ticketId}`);
            try {
                // Forward the message to Freshservice as a comment/note
                const freshservice = require('./services/freshservice');
                
                let userDisplayName = message.user;
                try {
                    const userInfo = await client.users.info({ user: message.user });
                    if (userInfo && userInfo.user) {
                        userDisplayName = userInfo.user.profile.real_name || userInfo.user.name;
                    }
                } catch (e) {
                    console.error("Failed to fetch Slack user info:", e);
                }

                // Format comment body
                const commentBody = `[Slack Reply from ${userDisplayName}]: ${message.text || ""}`;
                
                await freshservice.addTicketNote(mapping.ticketId, commentBody, false);
                console.log(`✅ Forwarded Slack reply to Freshservice Ticket #${mapping.ticketId}`);
                
                // React with a checkmark to show the user it was synced
                await client.reactions.add({
                    channel: message.channel,
                    timestamp: message.ts,
                    name: 'white_check_mark'
                });
            } catch (err) {
                console.error("Failed to forward Slack thread reply to Freshservice:", err);
            }
            return; // Intercept and stop further L1 processing
        }
    }

    // Ignore messages that are handled via app_mention to prevent double-replies
    // Note: Bolt usually triggers both if the bot is mentioned in a channel
    const { cleanedText, isMentioned } = getMessageInfo(message.text || "");
    if (isMentioned && message.channel_type !== 'im') return;

    const userId = message.user;
    const channelId = message.channel;
    const state = conversationManager.getConversationState(userId);
    const isInConversation = state.state !== 'IDLE' || state.currentArticle !== null;
    const isDM = message.channel_type === 'im';

    // Proceed if:
    // 1. It's a DM
    // 2. We are already in a conversation (gathering info or troubleshooting)
    // 3. Proactive check (AI thinks it's an IT issue)
    if (isDM || isInConversation) {
        return await processMessage(cleanedText, userId, channelId, say, client, logger);
    }

    // For messages in channels that are NOT mentions, we only react if it looks like an IT issue
    // BUT in dedicated helpdesk channels, we might want to be more friendly.
    // Enhanced greeting check to handle "Hi bot", "Hello team", etc.
    const greetings = ['hi', 'hello', 'hey', 'yo', 'morning', 'afternoon', 'evening', 'hola'];
    const words = cleanedText.toLowerCase().split(/\s+/);
    const isGreeting = greetings.includes(words[0]) && words.length <= 4;

    if (isGreeting) {
        console.log(`⚡ Greeting detected: "${cleanedText}". Responding instantly.`);
        return await processMessage(cleanedText, userId, channelId, say, client, logger);
    }

    // Knowledge Base Check
    // Skip for "new" or "request" to allow AI to handle them as tickets
    const shouldSkipKB = cleanedText.toLowerCase().includes('new') ||
        cleanedText.toLowerCase().includes('request') ||
        cleanedText.toLowerCase().includes('ticket') ||
        cleanedText.toLowerCase().includes('raise');

    const articleMatch = shouldSkipKB ? null : knowledgeBase.findArticle(cleanedText);
    if (articleMatch) {
        console.log(`✅ Proactive KB match: ${articleMatch.title}`);
        return await processMessage(cleanedText, userId, channelId, say, client, logger);
    }

    // Proactive Support AI check (only if no KB match)
    try {
        const intent = await aiService.detectIntent(cleanedText, { isDM });
        logProcess(`Proactive intent check for "${cleanedText}": ${JSON.stringify(intent)}`);

        // If it's an IT issue, process it
        if (intent.action === 'troubleshoot' || intent.action === 'create_ticket' || intent.action === 'quick_ticket' || intent.needs_troubleshooting || (intent.action === 'answer' && intent.direct_answer)) {
            // Pass the intent to processMessage to avoid second call
            return await processMessage(cleanedText, userId, channelId, say, client, logger, intent);
        }
    } catch (err) {
        console.error("Proactive intent check failed:", err);
    }
});


// --- Action Handlers ---

// Button: Report Issue
app.action('report_issue', async ({ body, client, ack }) => {
    await ack();
    try {
        await client.views.open({
            trigger_id: body.trigger_id,
            view: modalViews.reportIssueModal(body.trigger_id)
        });
    } catch (error) {
        console.error(error);
    }
});

// Button: Step Solved
app.action('step_solved', async ({ body, ack, say, client }) => {
    await ack();
    const userId = body.user.id;
    const channelId = body.channel.id;
    const isDM = channelId.startsWith('D');

    const msg = `Great! I'm glad we could resolve that for you. Let me know if you need anything else!`;

    if (isDM) {
        await say(msg);
    } else {
        await client.chat.postEphemeral({
            channel: channelId,
            user: userId,
            text: msg
        });
    }

    // Log deflection to analytics
    const state = conversationManager.getConversationState(userId);
    const articleId = state.currentArticle ? state.currentArticle.id : 'unknown';
    const analyticsService = require('./services/analyticsService');
    analyticsService.logDeflection(userId, articleId, 'kb').catch(err => console.error(err));

    conversationManager.clearConversationState(userId);
});

// Button: Step Failed
app.action('step_failed', async ({ body, ack, say, action, client }) => {
    await ack();
    const userId = body.user.id;
    const channelId = body.channel.id;
    const isDM = channelId.startsWith('D');
    const state = conversationManager.getConversationState(userId);
    const value = JSON.parse(action.value);
    const article = state.currentArticle;

    const smartSay = async (args) => {
        if (typeof args === 'string') args = { text: args };
        if (isDM) {
            return await say(args);
        } else {
            return await client.chat.postEphemeral({
                channel: channelId,
                user: userId,
                ...args
            });
        }
    };

    if (!article) {
        await smartSay("Something went wrong with your session. Please try again.");
        return;
    }

    const nextStepIndex = value.step; // current step index (1-based in UI, so this is effectively next index)

    // Requirement: Create ticket after 5 steps if unresolved
    // Using a simple counter in session state
    const attempts = (state.attempts || 0) + 1;
    conversationManager.updateConversationState(userId, { attempts });

    // Check if max steps (5) reached or no more steps in the article
    if (attempts >= 5 || nextStepIndex >= article.steps.length) {
        // Auto-initiate gathering instead of immediate creation
        if (!state.ticketCreated) {
            const reason = attempts >= 5 ? "Reached maximum troubleshooting steps" : "No more steps in guide";

            conversationManager.updateConversationState(userId, {
                state: 'AWAITING_EMP_ID',
                pendingTicketData: {
                    subject: `Unresolved Issue: ${article.title}`,
                    description: `User attempted troubleshooting for ${article.title} but was not resolved after ${attempts} steps.\n\nSummary: ${reason}`,
                    type: article.issue_type || 'General'
                }
            });

            await say(`It looks like we haven't been able to resolve this yet (${reason}). I'll help you raise a support ticket. First, could you please provide your **Employee ID**?`);
        }
    } else {
        // Show next step
        const nextStep = article.steps[nextStepIndex];
        conversationManager.updateConversationState(userId, { step: nextStepIndex + 1 });

        await smartSay({
            text: `Let's try the next step.`,
            blocks: messageViews.troubleshootingStep(nextStep.instruction, nextStepIndex + 1, article.steps.length, article.id)
        });
    }
});

// Modal Submission
app.view('submit_issue', async ({ ack, body, view, client }) => {
    await ack();
    const description = view.state.values.issue_description_block.issue_description.value;
    const topic = view.state.values.issue_type_block.issue_type.selected_option.text.text;
    const userId = body.user.id;

    try {
        // Create ticket
        const ticket = await freshservice.createTicket({
            subject: `New Issue: ${topic}`,
            description: description,
            email: "user@example.com"
        });

        await client.chat.postMessage({
            channel: userId,
            blocks: messageViews.ticketCreated(ticket.id)
        });

        // Log ticket to analytics
        const analyticsService = require('./services/analyticsService');
        analyticsService.logTicket(ticket.id, userId, topic.toLowerCase() || 'general').catch(err => console.error(err));

    } catch (error) {
        console.error(error);
        await client.chat.postMessage({
            channel: userId,
            text: "There was an error creating your ticket. Please try again later."
        });
    }
});


// --- Freshservice Webhook Endpoint ---

// Create separate Express server for webhooks (Socket Mode doesn't expose HTTP server)
const express = require('express');
const webhookApp = express();
const webhookPort = config.webhookPort || 3000;

webhookApp.use(express.json());
webhookApp.use(express.static('public'));

// Import and mount Admin Routes
const adminRoutes = require('./services/adminRoutes');
webhookApp.use('/api/admin', adminRoutes);

/**
 * Webhook endpoint to receive Freshservice ticket updates
 * POST /freshservice/webhook
 */
/**
 * Webhook endpoint to receive Freshservice ticket updates
 * POST /freshservice/webhook
 */
webhookApp.post('/freshservice/webhook', async (req, res) => {
    try {
        console.log('📨 Received Freshservice webhook:', JSON.stringify(req.body, null, 2));

        // Extract ticket information from webhook payload
        // Freshservice webhook structure may vary - adjust based on actual payload
        const ticketData = req.body.ticket || req.body;
        const ticketId = ticketData.id || ticketData.ticket_id;

        if (!ticketId) {
            console.warn('⚠️ Webhook received without ticket ID');
            return res.status(400).json({ error: 'Missing ticket ID' });
        }

        // Get user mapping
        const ticketUserMap = require('./services/ticketUserMap');
        const mapping = ticketUserMap.getMapping(ticketId);

        if (!mapping) {
            console.log(`ℹ️ No user mapping found for ticket ${ticketId}`);
            return res.status(200).json({ message: 'No mapping found, ignoring' });
        }

        // Extract update information
        const subject = ticketData.subject || 'Your Ticket';
        const status = ticketData.status_name || ticketData.status || 'Updated';
        const latestNote = ticketData.latest_note || ticketData.description_text || '';
        const updatedBy = ticketData.responder_name || ticketData.updated_by || 'Support Team';

        // Check if this is a sensitive ticket (domain lock or password reset)
        const isSensitiveTicket = mapping.isSensitive;
        const ticketType = mapping.ticketType;

        console.log(`🔍 Ticket ${ticketId} - Type: ${ticketType}, Sensitive: ${isSensitiveTicket}`);

        if (isSensitiveTicket) {
            // ========== SENSITIVE TICKET HANDLING ==========
            // For domain lock and password reset, send PRIVATE DM ONLY
            console.log(`🔐 Processing sensitive ticket ${ticketId} of type ${ticketType}`);

            // Fetch the latest reply from Freshservice to show user the automation response
            const latestReply = await freshservice.getLatestTicketReply(ticketId);

            if (!latestReply) {
                console.log(`⚠️ No reply found for sensitive ticket ${ticketId}, skipping notification`);
                return res.status(200).json({ message: 'No reply to send' });
            }

            // Determine the ticket type name for display
            const ticketTypeName = ticketType === 'domain_lock' ? 'Domain Lock' :
                ticketType === 'password_reset' ? 'Password Reset' :
                    'Security';

            // Create secure private message
            const secureMessage = {
                channel: mapping.userId, // Send directly to user's DM
                text: `🔐 ${ticketTypeName} Request Update`,
                blocks: [
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": `*🔐 ${ticketTypeName} Request Processed*\n\nYour request has been handled by our automated system.`
                        }
                    },
                    {
                        "type": "divider"
                    },
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": `*Ticket #${ticketId}*\n${subject}\n\n*Status:* ${status}`
                        }
                    },
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": `*📝 Response from IT Support:*\n\`\`\`\n${latestReply}\n\`\`\``
                        }
                    },
                    {
                        "type": "context",
                        "elements": [
                            {
                                "type": "mrkdwn",
                                "text": `🔒 _This is a private, secure message. Only you can see this information._`
                            }
                        ]
                    },
                    {
                        "type": "context",
                        "elements": [
                            {
                                "type": "mrkdwn",
                                "text": `Updated: ${new Date().toLocaleString()}`
                            }
                        ]
                    }
                ]
            };

            // Send PRIVATE DM (never to channel, never ephemeral)
            await app.client.chat.postMessage(secureMessage);

            console.log(`✅ Sent PRIVATE notification to user ${mapping.userId} for sensitive ticket ${ticketId}`);
            res.status(200).json({ message: 'Secure notification sent' });

        } else {
            // ========== GENERAL TICKET HANDLING ==========
            // Existing behavior for non-sensitive tickets
            let updateMessage = '';
            let emoji = '📬';

            if (ticketData.status === 4 || ticketData.status === 5) {
                // Ticket resolved or closed
                emoji = '✅';
                updateMessage = `*Your ticket has been ${status}!*\n\n*Ticket #${ticketId}:* ${subject}`;
            } else if (latestNote && latestNote.trim().length > 0) {
                // New reply/note
                emoji = '💬';
                updateMessage = `*New update on your ticket from ${updatedBy}:*\n\n*Ticket #${ticketId}:* ${subject}\n\n_Update:_\n${latestNote.substring(0, 500)}${latestNote.length > 500 ? '...' : ''}`;
            } else {
                // Status change
                emoji = '🔄';
                updateMessage = `*Ticket status updated to: ${status}*\n\n*Ticket #${ticketId}:* ${subject}`;
            }

            // Send notification to user (threaded if mapping exists)
            const targetChannel = mapping.channelId || mapping.userId;
            const targetThread = mapping.threadTs || undefined;

            await app.client.chat.postMessage({
                channel: targetChannel,
                thread_ts: targetThread,
                text: `${emoji} Ticket Update`,
                blocks: [
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": updateMessage
                        }
                    },
                    {
                        "type": "context",
                        "elements": [
                            {
                                "type": "mrkdwn",
                                "text": `Updated: ${new Date().toLocaleString()}`
                            }
                        ]
                    }
                ]
            });

            console.log(`✅ Notified user ${mapping.userId} about ticket ${ticketId} update in thread ${targetThread}`);
            res.status(200).json({ message: 'Notification sent' });
        }

    } catch (error) {
        console.error('❌ Error processing webhook:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start webhook server
webhookApp.listen(webhookPort, () => {
    console.log(`🔗 Webhook endpoint ready at: http://localhost:${webhookPort}/freshservice/webhook`);
});


// End of App Logic
