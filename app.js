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
async function processMessage(text, userId, channelId, messageTs, say, client, logger, cachedIntent = null) {
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

    // Helper to delete the user's message containing sensitive info (only in channels)
    const deleteUserMessage = async () => {
        if (!isDM && messageTs) {
            try {
                await client.chat.delete({
                    channel: channelId,
                    ts: messageTs
                });
                logProcess(`Deleted sensitive user message ${messageTs} in channel ${channelId}`);
            } catch (err) {
                console.error("Could not delete message (missing permissions or TS):", err.message);
            }
        }
    };

    try {
        logProcess(`Processing message from ${userId} in ${channelId}: "${text}"`);
        const state = conversationManager.getConversationState(userId);

        // --- 0. Handle Data Gathering States ---





        // 0.5 INSTANT KNOWLEDGE BASE MATCH (Prioritize speed for known issues)
        // Skip for "new" requests, "tickets", "install" or sensitive issues (domain lock/password reset) to allow directly creating tickets
        const lowerText = text.toLowerCase();
        
        const isDomainLock = /domain.{0,4}lock|domainlock(ed)?|unlock.{0,10}domain|unlock.{0,10}account|account.{0,10}disable(d)?|locked.{0,10}out|can'?t.{0,10}access.{0,10}account/i.test(lowerText) &&
            !/email.{0,20}(account|mail).{0,15}lock|email.{0,20}lock|mail.{0,20}lock|zoho.{0,20}lock|outlook.{0,20}lock|gmail.{0,20}lock/i.test(lowerText);
        const isPasswordReset = /pa?s+w[oa]?r?d?.{0,4}reset|reset.{0,10}pa?s+w[oa]?r?d?|pwd.{0,4}reset|forgot.{0,10}pa?s+w[oa]?r?d?|pa?s+w[oa]?r?d?.{0,10}expire(d)?/i.test(lowerText);
        
        const isBiometricAccessRequest = lowerText.includes('provide biometric') || lowerText.includes('grant biometric') ||
            lowerText.includes('biometric access') || lowerText.includes('biometric request') ||
            lowerText.includes('new biometric') || /need.{0,10}biometric/i.test(lowerText);
            
        const socialApps = ['whatsapp', 'whats app', 'instagram', 'facebook', 'telegram', 'twitter', 'linkedin', 'social media', 'messenger'];
        const hasSocialApp = socialApps.some(app => lowerText.includes(app));
        const isSocialAccessRequest = hasSocialApp && (/need.{0,15}access|request.{0,15}access|provide.{0,15}access|grant.{0,15}access|want.{0,15}access|enable.{0,15}access/i.test(lowerText) || 
            lowerText.includes('access') || lowerText.includes('unblock') || lowerText.includes('enable'));

        const isInstallRequest = lowerText.includes('install') && !/(already|have|has|had).{0,15}install|login/i.test(lowerText);

        const isRequest = lowerText.includes('new ') || lowerText.includes('request') ||
            lowerText.includes('ticket') || lowerText.includes('raise') || isInstallRequest ||
            isDomainLock || isPasswordReset || isBiometricAccessRequest || isSocialAccessRequest;


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

        if (intent.action === 'clarification_needed') {
            await smartSay({
                text: "I need a bit more detail to help you effectively. Could you please clarify what is not working? For example, which application is showing the error, or where exactly are you not receiving notifications?"
            });
            return;
        }

        if (isQuickTicket) {
            const ticketType = intent.issue_type; // domain_lock, password_reset, biometric, software_install

            // Software install: Ask if Personal or Company laptop
            if (ticketType === 'software_install') {
                const installArticle = knowledgeBase.findArticle(text) || knowledgeBase.findArticleByIssueType('software_install');

                conversationManager.updateConversationState(userId, {
                    state: 'AWAITING_LAPTOP_TYPE',
                    pendingTicketData: {
                        subject: `Software Installation Approval Required`,
                        description: `User requested a software installation.\n\nOriginal request: "${text}"`,
                        type: 'software_install',
                        originalText: text,
                        isSoftwareInstall: true,
                        pendingInstallArticle: installArticle
                    }
                });

                await smartSay({
                    text: "Are you installing this on a Personal Laptop or a Company Laptop?",
                    blocks: messageViews.laptopTypeSelection("Are you installing this on a Personal Laptop or a Company Laptop?")
                });
                return;
            }

            // Domain Lock / Password Reset / Biometric / Social Media: ask for Emp ID, Location, Email
            conversationManager.updateConversationState(userId, {
                state: 'AWAITING_MODAL_DETAILS',
                pendingTicketData: {
                    subject: '', // Will be formatted in finalizeTicket
                    description: `User request: ${text}`,
                    type: ticketType,
                    originalText: text,
                    isQuickTicket: true
                }
            });

            const ticketTypeName = ticketType === 'domain_lock' ? 'Domain Lock' :
                ticketType === 'password_reset' ? 'Password Reset' : 
                ticketType === 'biometric' ? 'Biometric Access' : 'Social Media Access';
            
            await smartSay({
                text: `I'll help you raise a ${ticketTypeName} request.`,
                blocks: messageViews.requestDetailsButton(`I'll help you raise a ${ticketTypeName} request.`)
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
                state: 'AWAITING_MODAL_DETAILS',
                pendingTicketData: {
                    subject: `Support Request: ${intent.issue_type || 'General'}`,
                    description: `User message: ${text}`,
                    type: intent.issue_type,
                    originalText: text
                }
            });

            await smartSay({
                text: "I'll help you raise a ticket for that.",
                blocks: messageViews.requestDetailsButton(`I'll help you raise a ticket for that.`)
            });
            return;
        }

        // 3. Handle troubleshooting
        if (intent.needs_troubleshooting || intent.action === 'troubleshoot' || (!intent.direct_answer && !isTicketRequest)) {
            let article = null;

            try {
                // Step 1: SEARCH BY ORIGINAL TEXT FROM USER (Since it may have been skipped earlier)
                console.log(`🔍 Step 2: Searching KB by original text: "${text}"`);
                article = knowledgeBase.findArticle(text);

                // Step 2: SEARCH BY ISSUE TYPE FROM AI (If no article found yet)
                if (!article && intent.issue_type) {
                    console.log(`🔍 Step 3: Searching by issue_type: "${intent.issue_type}"`);
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
                    const newArticleId = `auto_${intent.issue_type || 'general'}_${Date.now()}`;
                    article = {
                        id: newArticleId,
                        title: `Auto-Learned: ${text.length > 40 ? text.slice(0, 37) + '...' : text}`,
                        description: `Automatically generated troubleshooting steps for: ${text}`,
                        issue_type: intent.issue_type || "general",
                        keywords: text.toLowerCase().split(/[\s,]+/).filter(w => w.length >= 3),
                        steps: dynamicSteps
                    };
                    
                    // 🧠 AI Self-Learning: Save to KB
                    await knowledgeBase.saveArticle(article);
                    console.log(`✅ Generated and saved ${dynamicSteps.length} AI-specific steps as article: ${newArticleId}`);

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
            // Quick tickets: "Domain Lock - EMP123", "Password Reset - EMP123", "Biometric Access - EMP123", or "Social Media Access - EMP123"
            const ticketTypeName = data.type === 'domain_lock' ? 'Domain Lock' :
                data.type === 'password_reset' ? 'Password Reset' : 
                data.type === 'biometric' ? 'Biometric Access' : 'Social Media Access';
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
- Location: ${data.location || 'N/A (Quick Ticket)'}
- Email: ${data.email || 'N/A'}
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
            email: data.email || requesterEmail,
            name: requesterName
        });

        // Use say (public) for ticket confirmation so team knows
        let result;
        if (data.isSoftwareInstall) {
            result = await say({
                channel: channelId,
                text: `🔐 *Software Installation Request Created!*\n\nSupport ticket #*${ticket.id}* has been created for your software install request.\n\n• An IT agent will review and reach out to you shortly.\n• Our IT team agent will reach out to you; they will install the software for you.`
            });
        } else {
            result = await say({
                channel: channelId,
                text: `Support ticket #${ticket.id} created successfully.`,
                blocks: messageViews.ticketCreated(ticket.id)
            });
        }

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
    await processMessage(cleanedText, event.user, event.channel, event.ts, say, client, logger);
});

// Message Context (DMs and Proactive Channels)
app.message(async ({ message, say, client, logger }) => {
    logProcess(`app.message triggered! Channel: ${message.channel}, Type: ${message.channel_type}, BotID: ${message.bot_id}`);
    console.log(`DEBUG: app.message triggered! Channel: ${message.channel}, Type: ${message.channel_type}, BotID: ${message.bot_id}`);

    // Ignore bot messages and events without a user (e.g. message_deleted)
    if (message.bot_id || !message.user) return;

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
        return await processMessage(cleanedText, userId, channelId, message.ts, say, client, logger);
    }

    // For messages in channels that are NOT mentions, we only react if it looks like an IT issue
    // BUT in dedicated helpdesk channels, we might want to be more friendly.
    // Enhanced greeting check to handle "Hi bot", "Hello team", etc.
    const greetings = ['hi', 'hello', 'hey', 'yo', 'morning', 'afternoon', 'evening', 'hola'];
    const words = cleanedText.toLowerCase().split(/\s+/);
    const isGreeting = greetings.includes(words[0]) && words.length <= 4;

    if (isGreeting) {
        console.log(`⚡ Greeting detected: "${cleanedText}". Responding instantly.`);
        return await processMessage(cleanedText, userId, channelId, message.ts, say, client, logger);
    }

    // Knowledge Base Check
    // Skip for "new" or "request" to allow AI to handle them as tickets
    const lowerTextForKB = cleanedText.toLowerCase();
    const isInstallReqStr = lowerTextForKB.includes('install') && !/(already|have|has|had).{0,15}install|login/i.test(lowerTextForKB);

    const shouldSkipKB = lowerTextForKB.includes('new') ||
        lowerTextForKB.includes('request') ||
        lowerTextForKB.includes('ticket') ||
        lowerTextForKB.includes('raise') ||
        isInstallReqStr ||
        /domain.{0,4}lock|domainlock(ed)?/i.test(lowerTextForKB) ||
        /pa?s+w[oa]?r?d?.{0,4}reset|reset.{0,4}pa?s+w[oa]?r?d?/i.test(lowerTextForKB);

    const articleMatch = shouldSkipKB ? null : knowledgeBase.findArticle(cleanedText);
    if (articleMatch) {
        console.log(`✅ Proactive KB match: ${articleMatch.title}`);
        return await processMessage(cleanedText, userId, channelId, message.ts, say, client, logger);
    }

    // Proactive Support AI check (only if no KB match)
    try {
        const intent = await aiService.detectIntent(cleanedText, { isDM });
        logProcess(`Proactive intent check for "${cleanedText}": ${JSON.stringify(intent)}`);
        const isTopicMatch = intent.action === 'troubleshoot' || intent.action === 'quick_ticket' || intent.action === 'create_ticket';

        if (isTopicMatch) {
            console.log(`✅ Proactive AI match: ${intent.issue_type} (Action: ${intent.action})`);
            return await processMessage(cleanedText, userId, channelId, message.ts, say, client, logger, intent);
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

// Button: Company Laptop Install
app.action('company_laptop_install', async ({ body, ack, client }) => {
    await ack();
    const userId = body.user.id;
    const channelId = body.channel.id;
    const isDM = channelId.startsWith('D');
    
    // Change state to AWAITING_MODAL_DETAILS
    conversationManager.updateConversationState(userId, {
        state: 'AWAITING_MODAL_DETAILS'
    });

    const msgArgs = {
        text: "I'll help you request IT Approval for this software installation.",
        blocks: messageViews.requestDetailsButton(`I'll help you request IT Approval for this software installation on your Company Laptop.`)
    };

    if (isDM) {
        await client.chat.postMessage({ channel: channelId, ...msgArgs });
    } else {
        await client.chat.postEphemeral({ channel: channelId, user: userId, ...msgArgs });
    }
});

// Button: Personal Laptop Install
app.action('personal_laptop_install', async ({ body, ack, client }) => {
    await ack();
    const userId = body.user.id;
    const channelId = body.channel.id;
    const isDM = channelId.startsWith('D');
    const state = conversationManager.getConversationState(userId);

    const article = state.pendingTicketData?.pendingInstallArticle;
    
    const smartSay = async (args) => {
        if (typeof args === 'string') args = { text: args };
        if (isDM) {
            return await client.chat.postMessage({ channel: channelId, ...args });
        } else {
            return await client.chat.postEphemeral({ channel: channelId, user: userId, ...args });
        }
    };

    if (!article || !article.steps || article.steps.length === 0) {
        await smartSay("I couldn't find the installation steps for this software. I'll help you raise a ticket instead.");
        conversationManager.updateConversationState(userId, { state: 'AWAITING_MODAL_DETAILS' });
        await smartSay({
            blocks: messageViews.requestDetailsButton(`I'll help you request IT Approval.`)
        });
        return;
    }

    // Clone the article to avoid modifying the original cached version
    const activeArticle = JSON.parse(JSON.stringify(article));

    // Remove the "Get IT Approval First" step if it's a personal laptop
    if (activeArticle.steps && activeArticle.steps.length > 0) {
        if (activeArticle.steps[0].title?.includes('IT Approval') || activeArticle.steps[0].instruction?.includes('Get IT Approval')) {
            activeArticle.steps.shift(); // Remove the first step
        }
    }

    if (activeArticle.steps.length === 0) {
        await smartSay("I couldn't find the installation steps for this software. I'll help you raise a ticket instead.");
        conversationManager.updateConversationState(userId, { state: 'AWAITING_MODAL_DETAILS' });
        await smartSay({
            blocks: messageViews.requestDetailsButton(`I'll help you request IT Approval.`)
        });
        return;
    }

    conversationManager.updateConversationState(userId, {
        step: 1,
        currentArticle: activeArticle,
        ticketCreated: false,
        attempts: 0
    });

    const firstStep = activeArticle.steps[0];
    await smartSay({
        text: `You can proceed with the installation yourself! Let's get started.`,
        blocks: messageViews.troubleshootingStep(firstStep.instruction, 1, activeArticle.steps.length, activeArticle.id)
    });
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
                state: 'AWAITING_MODAL_DETAILS',
                pendingTicketData: {
                    subject: `Unresolved Issue: ${article.title}`,
                    description: `User attempted troubleshooting for ${article.title} but was not resolved after ${attempts} steps.\n\nSummary: ${reason}`,
                    type: article.issue_type || 'General'
                }
            });

            await smartSay({
                blocks: messageViews.requestDetailsButton(`It looks like we haven't been able to resolve this yet (${reason}). I'll help you raise a support ticket.`)
            });
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

// Button: Open Details Modal
app.action('open_details_modal', async ({ body, ack, client }) => {
    await ack();
    const userId = body.user.id;
    const channelId = body.channel.id;
    const state = conversationManager.getConversationState(userId);

    if (!state || state.state !== 'AWAITING_MODAL_DETAILS' || !state.pendingTicketData) {
        try {
            await client.chat.postEphemeral({
                channel: channelId,
                user: userId,
                text: "Your session has expired or no pending request was found. Please start over."
            });
        } catch (e) {
            console.error("Expired session notify error:", e);
        }
        return;
    }

    // Ask for Hostname for everything EXCEPT identity-only issues like domain lock, password reset, biometric, and social media access
    const noHostnameTypes = ['domain_lock', 'password_reset', 'biometric', 'social_media_access'];
    const requiresHostname = !noHostnameTypes.includes(state.pendingTicketData.type);
    const isSoftwareInstall = state.pendingTicketData.type === 'software_install';

    try {
        await client.views.open({
            trigger_id: body.trigger_id,
            view: modalViews.collectDetailsModal(requiresHostname, isSoftwareInstall)
        });
        
        // Save channelId explicitly since modal submissions lose channel interaction context
        conversationManager.updateConversationState(userId, { channelId: channelId });
    } catch (error) {
        console.error("Error opening details modal:", error);
    }
});

// View Submission: Collect Details Modal
app.view('submit_details', async ({ body, ack, view, client }) => {
    await ack();
    const userId = body.user.id;
    const state = conversationManager.getConversationState(userId);

    if (!state || !state.pendingTicketData) {
        return;
    }

    const values = view.state.values;
    const empId = values.emp_id_block.emp_id.value;
    const location = values.location_block.location.value;
    const email = values.email_block.email.value;
    
    let hostname = null;
    const privateMetadata = JSON.parse(view.private_metadata || "{}");
    if (privateMetadata.requiresHostname) {
        const rawHostname = values.hostname_block.hostname.value;
        const isUnknown = rawHostname.toLowerCase().includes("don't know") || rawHostname.toLowerCase().includes("dont know") ||
                rawHostname.toLowerCase().includes("no idea") || rawHostname.toLowerCase().includes("not sure") || rawHostname.toLowerCase().includes("unknown") ||
                rawHostname.toLowerCase().includes("serial number") || rawHostname.toLowerCase().includes("n/a") || rawHostname.trim() === '-';
        hostname = isUnknown ? 'Unknown (User Not Sure)' : rawHostname.trim();
    }

    const pendingData = { 
        ...state.pendingTicketData, 
        empId, 
        location, 
        email 
    };
    
    if (hostname) {
        pendingData.hostname = hostname;
    }

    const channelId = state.channelId || userId;
    const isDM = channelId.startsWith('D');
    
    const say = async (args) => {
        if (typeof args === 'string') args = { text: args };
        return await client.chat.postMessage({ channel: channelId, ...args });
    };

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

    try {
        await finalizeTicket(pendingData, userId, channelId, smartSay, say, client);
    } catch (error) {
        console.error("Error in finalizeTicket from modal:", error);
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
            let latestReply = await freshservice.getLatestTicketReply(ticketId);

            if (!latestReply && latestNote) {
                console.log(`ℹ️ Falling back to webhook provided latest_note`);
                latestReply = latestNote;
            }

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
