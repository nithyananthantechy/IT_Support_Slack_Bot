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
    const lower = text.toLowerCase();

    // --- VAGUE QUERY CLARIFICATION ---
    const isVagueError = /^error$/i.test(lower) || /^issue$/i.test(lower) || /^(it is |it's |its |this is |it )?not.{0,10}working$/i.test(lower) || /error.{0,10}showing/i.test(lower) || /page.{0,10}not.{0,10}found/i.test(lower);
    const isVagueNotification = /notification.{0,20}(not )?(receiv|work|come)/i.test(lower) && !lower.includes('email') && !lower.includes('slack') && !lower.includes('mfa') && !lower.includes('teams');

    if (isVagueError || isVagueNotification) {
        return { issue_type: "general", action: "clarification_needed", needs_troubleshooting: false };
    }

    // --- MFA FAILURE (handle BEFORE OTP to prevent 'authenticator code' matching OTP) ---
    if (/mfa.{0,20}(fail|not.work|issue|problem|invalid|wrong|error)|multi.?factor.{0,20}(fail|not.work|issue)|(authenticator|2fa).{0,20}(fail|not.work|invalid|wrong|expired|issue)/i.test(lower)) {
        return { issue_type: "mfa_failure", action: "troubleshoot", needs_troubleshooting: true };
    }

    // --- OTP / VERIFICATION CODE (handle BEFORE software_install to prevent Zoho OTP → install flow) ---
    const isOtpIssue = /otp.{0,30}(not|no|didn'?t|never|haven'?t|not.{0,5}(receiv|arriv|come|get))|not.{0,20}receiv.{0,20}otp|(verification|auth).{0,15}code.{0,20}(not|no|fail|wrong|invalid|expired|receiv)|not.{0,10}receiv.{0,15}(verif|code|otp)|(otp|code).{0,10}not.{0,10}(receiv|work|arriv|come)/i.test(lower);
    if (isOtpIssue) {
        return { issue_type: "email_otp", action: "troubleshoot", needs_troubleshooting: true };
    }

    // --- EMAIL ACCOUNT LOCKED (handle BEFORE domain_lock to give troubleshooting first) ---
    const isEmailAccountLocked = /email.{0,20}(account|mail).{0,15}lock|email.{0,20}lock|mail.{0,20}lock|(account|mail).{0,15}lock.{0,15}email|zoho.{0,20}lock|outlook.{0,20}lock|gmail.{0,20}lock/i.test(lower);
    if (isEmailAccountLocked) {
        return { issue_type: "email_account_locked", action: "troubleshoot", needs_troubleshooting: true };
    }

    // --- EMAIL SESSION EXPIRED ---
    const isEmailSession = /email.{0,20}session.{0,20}(expir|timeout|logout|log.?out)|session.{0,20}expir.{0,20}(email|mail|zoho|outlook)|email.{0,15}keeps?.{0,15}(log.?out|sign.?out|expir)|keeps?.{0,15}(log.?out|sign.?out).{0,20}(email|mail|zoho)/i.test(lower);
    if (isEmailSession) {
        return { issue_type: "email_session", action: "troubleshoot", needs_troubleshooting: true };
    }

    // --- HIGH CPU ---
    if (/high.{0,5}cpu|cpu.{0,10}(high|usage|spike|100|maxed)|processor.{0,10}(high|usage)|cpu.{0,5}running.{0,5}(high|100)|running.{0,5}at.{0,5}100/i.test(lower)) {
        return { issue_type: "high_cpu", action: "troubleshoot", needs_troubleshooting: true };
    }

    // --- SLOW INTERNET ---
    if (/slow.{0,10}internet|internet.{0,10}slow|slow.{0,10}(network|connection|browsing|speed)|internet.{0,10}(speed|lagging|lag)|poor.{0,10}internet|bad.{0,10}internet|video.{0,10}buffer/i.test(lower)) {
        return { issue_type: "slow_internet", action: "troubleshoot", needs_troubleshooting: true };
    }

    // --- MFA FAILURE ---
    if (/mfa.{0,20}(fail|not.work|issue|problem|invalid|wrong|error)|multi.?factor.{0,20}(fail|not.work|issue)|(authenticator|2fa).{0,20}(fail|not.work|invalid|wrong|expired|issue)/i.test(lower)) {
        return { issue_type: "mfa_failure", action: "troubleshoot", needs_troubleshooting: true };
    }

    // --- QUICK TICKET FAST PATH (typo-tolerant) ---
    // Note: domain_lock check EXCLUDES email-specific patterns (those are handled above as troubleshoot)
    const isDomainLock = /domain.{0,4}lock|domainlock(ed)?|unlock.{0,10}domain|unlock.{0,10}account|account.{0,10}disable(d)?|locked.{0,10}out/i.test(lower) && !isEmailAccountLocked;
    const isPasswordReset = /pa?s+w[oa]?r?d?.{0,4}reset|reset.{0,10}pa?s+w[oa]?r?d?|pwd.{0,4}reset|forgot.{0,10}pa?s+w[oa]?r?d?|pa?s+w[oa]?r?d?.{0,10}expire(d)?/i.test(lower);

    if (isDomainLock) {
        return { issue_type: "domain_lock", action: "quick_ticket", needs_troubleshooting: false };
    }
    if (isPasswordReset) {
        return { issue_type: "password_reset", action: "quick_ticket", needs_troubleshooting: false };
    }
    const isBiometricAccessRequest = lower.includes('new biometric') || lower.includes('request biometric') ||
        lower.includes('biometric access') || lower.includes('biometric request') ||
        lower.includes('provide biometric') || lower.includes('grant biometric') ||
        lower.includes('biometric provision') || /need.{0,10}biometric/i.test(lower);
    const isBiometricIssue = /biometric.{0,20}(issue|problem|not work|fail|error|trouble)/i.test(lower) ||
        /biometric.{0,20}(broken|doesn'?t work)/i.test(lower) ||
        /(issue|problem|trouble).{0,20}biometric/i.test(lower);
    if (isBiometricAccessRequest && !isBiometricIssue) {
        return { issue_type: "biometric", action: "quick_ticket", needs_troubleshooting: false };
    }

    // --- SOCIAL MEDIA ACCESS (ticket) vs SOCIAL MEDIA ISSUE (troubleshoot) ---
    const socialApps = ['whatsapp', 'whats app', 'instagram', 'facebook', 'telegram', 'twitter', 'linkedin', 'social media', 'messenger'];
    const hasSocialApp = socialApps.some(app => lower.includes(app));
    if (hasSocialApp) {
        const isSocialAccessRequest = /need.{0,15}access|request.{0,15}access|provide.{0,15}access|grant.{0,15}access|access.{0,10}(request|need)|want.{0,15}access|enable.{0,15}access/i.test(lower) ||
            lower.includes('access') || lower.includes('unblock') || lower.includes('enable');
        const isSocialIssue = /(not work|issue|problem|error|crash|fail|trouble|can'?t open|won'?t open|down|slow|hang|freeze|bug)/i.test(lower);
        if (isSocialIssue) {
            return { issue_type: "social_media_issue", action: "troubleshoot", needs_troubleshooting: true };
        }
        if (isSocialAccessRequest) {
            return { issue_type: "social_media_access", action: "quick_ticket", needs_troubleshooting: false };
        }
    }

    // --- BIOMETRIC APPROVAL RESPONSE ---
    if (/i.{0,5}(got|received|have).{0,15}approv/i.test(lower) || /approv(al|ed)/i.test(lower)) {
        return { action: "answer", direct_answer: "Thank you! Our IT team agent will reach out to you shortly to provide access. Please keep your Employee ID ready.", needs_troubleshooting: false };
    }

    // --- TICKET CREATION ---
    if (lower.includes('raise ticket') || lower.includes('create ticket') || lower.includes('new ticket') || lower.includes('log ticket') || lower.includes('need a ticket') || lower.includes('open ticket')) {
        return { issue_type: "general", action: "create_ticket", needs_troubleshooting: false };
    }

    // --- SOFTWARE INSTALL REQUEST ---
    // Note: OTP check above ensures "zoho otp" won't fall through to software_install
    const isAlreadyInstalled = /(already|have|has|had).{0,15}install|login/i.test(lower);
    if ((lower.includes('install') || lower.includes('need to install') || lower.includes('install package') || lower.includes('request software') || lower.includes('wps') || lower.includes('software request')) && !isAlreadyInstalled && !isOtpIssue) {
        return { issue_type: "software_install", action: "quick_ticket", needs_troubleshooting: false };
    }

    // --- NETWORK / INTERNET ---
    if (lower.includes('wifi') || lower.includes('wi-fi') || lower.includes('internet') || lower.includes('network') || lower.includes('no connection') || lower.includes('not connecting') || lower.includes('lan') || lower.includes('ethernet') || lower.includes('net issue') || lower.includes('net problem')) {
        return { issue_type: "network", action: "troubleshoot", needs_troubleshooting: true };
    }

    // --- VPN ---
    if (lower.includes('vpn') || lower.includes('tunnel') || lower.includes('remote access') || lower.includes('ssl vpn')) {
        return { issue_type: "vpn", action: "troubleshoot", needs_troubleshooting: true };
    }

    // --- PRINTER ---
    if (lower.includes('printer') || lower.includes('printing') || lower.includes('print queue') || lower.includes('scanner') || lower.includes('scan')) {
        return { issue_type: "printer", action: "troubleshoot", needs_troubleshooting: true };
    }

    // --- HARDWARE (keyboard, mouse, screen, etc.) ---
    if (lower.includes('keyboard') || lower.includes('mouse') || lower.includes('monitor') || lower.includes('screen') || lower.includes('display') || lower.includes('usb') || lower.includes('charger') || lower.includes('charging') || lower.includes('battery') || lower.includes('hardware') || lower.includes('device') || lower.includes('headset') || lower.includes('headphone') || lower.includes('webcam') || lower.includes('camera') || lower.includes('microphone')) {
        return { issue_type: "hardware", action: "troubleshoot", needs_troubleshooting: true };
    }

    // --- SLOW / PERFORMANCE ---
    if (lower.includes('hanging') || lower.includes('freezing') || lower.includes('frozen') || lower.includes('lag') || lower.includes('performance') || lower.includes('unresponsive') || lower.includes('not responding') || lower.includes('ram')) {
        return { issue_type: "software", action: "troubleshoot", needs_troubleshooting: true };
    }
    if (lower.includes('slow') && !lower.includes('internet') && !lower.includes('network') && !lower.includes('wifi') && !lower.includes('wi-fi')) {
        return { issue_type: "software", action: "troubleshoot", needs_troubleshooting: true };
    }

    // --- BLUE SCREEN / CRASH ---
    if (lower.includes('blue screen') || lower.includes('bsod') || lower.includes('black screen') || lower.includes('crash') || lower.includes('restart') || lower.includes('reboot') || lower.includes('shutdown') || lower.includes('not booting') || lower.includes('won\'t start')) {
        return { issue_type: "software", action: "troubleshoot", needs_troubleshooting: true };
    }

    // --- MALWARE / VIRUS ---
    if (lower.includes('malware') || lower.includes('virus') || lower.includes('infected') || lower.includes('infection') || lower.includes('ransomware') || lower.includes('trojan') || lower.includes('spyware') || lower.includes('threat detected') || lower.includes('antivirus')) {
        return { issue_type: "malware", action: "troubleshoot", needs_troubleshooting: true };
    }



    // --- SOFTWARE / APP ISSUES ---
    if (lower.includes('software') || lower.includes('application') || lower.includes('app') || lower.includes('uninstall') || lower.includes('update') || lower.includes('upgrade') || lower.includes('office') || lower.includes('excel') || lower.includes('word') || lower.includes('teams') || lower.includes('zoom') || lower.includes('chrome') || lower.includes('browser') || lower.includes('error') || lower.includes('not working') || lower.includes('not opening') || lower.includes("won't open") || lower.includes('slack')) {
        return { issue_type: "software", action: "troubleshoot", needs_troubleshooting: true };
    }

    // --- EMAIL ---
    if (lower.includes('email') || lower.includes('mail') || lower.includes('outlook') || lower.includes('gmail') || lower.includes('inbox') || lower.includes('smtp') || lower.includes('calendar') || lower.includes('meeting invite')) {
        return { issue_type: "email", action: "troubleshoot", needs_troubleshooting: true };
    }

    // --- PASSWORD / ACCESS ---
    if (lower.includes('password') || lower.includes('forgot') || lower.includes('locked out') || lower.includes('login') || lower.includes('cannot login') || lower.includes('access denied') || lower.includes('account')) {
        return { issue_type: "password_reset", action: "quick_ticket", needs_troubleshooting: false };
    }

    // --- BIOMETRIC ISSUE (troubleshoot) vs BIOMETRIC ACCESS (ticket) ---
    if (lower.includes('biometric') || lower.includes('fingerprint') || lower.includes('attendance') || lower.includes('punch')) {
        const isBioRequest = lower.includes('new biometric') || lower.includes('request biometric') ||
            lower.includes('biometric access') || lower.includes('biometric request') ||
            lower.includes('provide biometric') || lower.includes('grant biometric') ||
            /need.{0,10}biometric/i.test(lower);
        const isBioIssue = /biometric.{0,20}(issue|problem|not work|fail|error)/i.test(lower) ||
            /(issue|problem|trouble).{0,20}biometric/i.test(lower);
        if (isBioRequest && !isBioIssue) {
            return { issue_type: "biometric", action: "quick_ticket", needs_troubleshooting: false };
        }
        return { issue_type: "biometric", action: "troubleshoot", needs_troubleshooting: true };
    }

    // --- GREETING ---
    const greetings = ['hi', 'hello', 'hey', 'yo', 'morning', 'afternoon', 'evening', 'hola'];
    const words = lower.split(/\s+/);
    if (greetings.includes(words[0]) && words.length <= 4) {
        return { action: "answer", direct_answer: "Hello! I'm your IT Helpdesk Assistant. How can I help you today?", needs_troubleshooting: false };
    }

    // --- GENERAL FALLBACK ---
    return { action: "troubleshoot", needs_troubleshooting: true, issue_type: "general" };
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
    // 1.45 FAST VAGUE QUERY CLARIFICATION check
    const isVagueErrorFast = /^error$/i.test(lowerText) || /^issue$/i.test(lowerText) || /^(it is |it's |its |this is |it )?not.{0,10}working$/i.test(lowerText) || /error.{0,10}showing/i.test(lowerText) || /page.{0,10}not.{0,10}found/i.test(lowerText);
    const isVagueNotificationFast = /notification.{0,20}(not )?(receiv|work|come)/i.test(lowerText) && !lowerText.includes('email') && !lowerText.includes('slack') && !lowerText.includes('mfa') && !lowerText.includes('teams');

    if (isVagueErrorFast || isVagueNotificationFast) {
        console.log(`⚡ Fast-path clarification needed match: "${lowerText}"`);
        return {
            action: "clarification_needed",
            issue_type: "general",
            needs_troubleshooting: false
        };
    }

    // 1.46 FAST MFA FAILURE check (MUST be BEFORE OTP check to avoid 'authenticator code' matching OTP)
    if (/mfa.{0,20}(fail|not.work|issue|problem|invalid|wrong|error)|multi.?factor.{0,20}(fail|not.work|issue)|(authenticator|2fa).{0,20}(fail|not.work|invalid|wrong|expired|issue)/i.test(lowerText)) {
        console.log(`⚡ Fast-path MFA failure match: "${lowerText}"`);
        return {
            action: "troubleshoot",
            issue_type: "mfa_failure",
            needs_troubleshooting: true
        };
    }

    // 1.46 FAST OTP / VERIFICATION CODE check (MUST be before software_install to prevent Zoho OTP → install)
    const isOtpIssueFast = /otp.{0,30}(not|no|didn'?t|never|haven'?t|not.{0,5}(receiv|arriv|come|get))|not.{0,20}receiv.{0,20}otp|(verification|auth).{0,15}code.{0,20}(not|no|fail|wrong|invalid|expired|receiv)|not.{0,10}receiv.{0,15}(verif|code|otp)|(otp|code).{0,10}not.{0,10}(receiv|work|arriv|come)/i.test(lowerText);
    if (isOtpIssueFast) {
        console.log(`⚡ Fast-path OTP issue match: "${lowerText}"`);
        return {
            action: "troubleshoot",
            issue_type: "email_otp",
            needs_troubleshooting: true
        };
    }

    // 1.47 FAST EMAIL ACCOUNT LOCKED check (MUST be before domain_lock to give troubleshooting first)
    const isEmailAccountLockedFast = /email.{0,20}(account|mail).{0,15}lock|email.{0,20}lock|mail.{0,20}lock|(account|mail).{0,15}lock.{0,15}email|zoho.{0,20}lock|outlook.{0,20}lock|gmail.{0,20}lock/i.test(lowerText);
    if (isEmailAccountLockedFast) {
        console.log(`⚡ Fast-path email account locked match: "${lowerText}"`);
        return {
            action: "troubleshoot",
            issue_type: "email_account_locked",
            needs_troubleshooting: true
        };
    }

    // 1.48 FAST EMAIL SESSION EXPIRED check
    const isEmailSessionFast = /email.{0,20}session.{0,20}(expir|timeout|logout|log.?out)|session.{0,20}expir.{0,20}(email|mail|zoho|outlook)|email.{0,15}keeps?.{0,15}(log.?out|sign.?out|expir)|keeps?.{0,15}(log.?out|sign.?out).{0,20}(email|mail|zoho)/i.test(lowerText);
    if (isEmailSessionFast) {
        console.log(`⚡ Fast-path email session expired match: "${lowerText}"`);
        return {
            action: "troubleshoot",
            issue_type: "email_session",
            needs_troubleshooting: true
        };
    }

    // 1.49 FAST HIGH CPU check
    if (/high.{0,5}cpu|cpu.{0,10}(high|usage|spike|100|maxed)|processor.{0,10}(high|usage)|cpu.{0,5}running.{0,5}(high|100)|running.{0,5}at.{0,5}100/i.test(lowerText)) {
        console.log(`⚡ Fast-path high CPU match: "${lowerText}"`);
        return {
            action: "troubleshoot",
            issue_type: "high_cpu",
            needs_troubleshooting: true
        };
    }

    // 1.50 FAST SLOW INTERNET check
    if (/slow.{0,10}internet|internet.{0,10}slow|slow.{0,10}(network|connection|browsing|speed)|internet.{0,10}(speed|lagging|lag)|poor.{0,10}internet|bad.{0,10}internet/i.test(lowerText)) {
        console.log(`⚡ Fast-path slow internet match: "${lowerText}"`);
        return {
            action: "troubleshoot",
            issue_type: "slow_internet",
            needs_troubleshooting: true
        };
    }

    // 1.5 FAST BIOMETRIC REQUEST check ("provide/grant biometric access" → ticket, "biometric issue" → troubleshoot)
    const isBiometricIssue = /biometric.{0,20}(issue|problem|not work|fail|error|trouble)/i.test(lowerText) ||
        /biometric.{0,20}(broken|doesn'?t work)/i.test(lowerText) ||
        /(issue|problem|trouble).{0,20}biometric/i.test(lowerText);
    const isBiometricRequest = lowerText.includes('new biometric') || lowerText.includes('request biometric') ||
        lowerText.includes('biometric access') || lowerText.includes('biometric request') ||
        lowerText.includes('provide biometric') || lowerText.includes('grant biometric') ||
        lowerText.includes('biometric provision') || /need.{0,10}biometric/i.test(lowerText);
    if (isBiometricRequest && !isBiometricIssue) {
        console.log(`⚡ Fast-path biometric ACCESS ticket match: "${lowerText}"`);
        return {
            action: "quick_ticket",
            issue_type: "biometric",
            needs_troubleshooting: false
        };
    }
    if (isBiometricIssue) {
        console.log(`⚡ Fast-path biometric ISSUE troubleshoot match: "${lowerText}"`);
        return {
            action: "troubleshoot",
            issue_type: "biometric",
            needs_troubleshooting: true
        };
    }

    // 1.55 FAST SOCIAL MEDIA ACCESS vs ISSUE check
    const socialApps = ['whatsapp', 'whats app', 'instagram', 'facebook', 'telegram', 'twitter', 'linkedin', 'social media', 'messenger'];
    const hasSocialApp = socialApps.some(app => lowerText.includes(app));
    if (hasSocialApp) {
        const isSocialIssue = /(not work|issue|problem|error|crash|fail|trouble|can'?t open|won'?t open|down|slow|hang|freeze|bug)/i.test(lowerText);
        const isSocialAccessRequest = /need.{0,15}access|request.{0,15}access|provide.{0,15}access|grant.{0,15}access|want.{0,15}access|enable.{0,15}access/i.test(lowerText) ||
            lowerText.includes('access') || lowerText.includes('unblock') || lowerText.includes('enable');
        if (isSocialIssue) {
            console.log(`⚡ Fast-path social media ISSUE troubleshoot match: "${lowerText}"`);
            return {
                action: "troubleshoot",
                issue_type: "social_media_issue",
                needs_troubleshooting: true
            };
        }
        if (isSocialAccessRequest) {
            console.log(`⚡ Fast-path social media ACCESS ticket match: "${lowerText}"`);
            return {
                action: "quick_ticket",
                issue_type: "social_media_access",
                needs_troubleshooting: false
            };
        }
    }

    // 1.56 FAST BIOMETRIC APPROVAL RESPONSE
    if (/i.{0,5}(got|received|have).{0,15}approv/i.test(lowerText) || (/approv(al|ed)/i.test(lowerText) && words.length <= 8)) {
        console.log(`⚡ Fast-path biometric approval response match: "${lowerText}"`);
        return {
            action: "answer",
            direct_answer: "Thank you! Our IT team agent will reach out to you shortly to provide access. Please keep your Employee ID ready.",
            needs_troubleshooting: false
        };
    }

    // 1.6 FAST DOMAIN LOCK & PASSWORD RESET check (typo-tolerant using expanded regex)
    // IMPORTANT: domain_lock excludes email-specific lock patterns (those are handled above as email_account_locked)
    const isDomainLockFast = /domain.{0,4}lock|domainlock(ed)?|unlock.{0,10}domain|unlock.{0,10}account|account.{0,10}disable(d)?|locked.{0,10}out/i.test(lowerText) && !isEmailAccountLockedFast;
    const isPasswordResetFast = /pa?s+w[oa]?r?d?.{0,4}reset|reset.{0,10}pa?s+w[oa]?r?d?|pwd.{0,4}reset|forgot.{0,10}pa?s+w[oa]?r?d?|pa?s+w[oa]?r?d?.{0,10}expire(d)?/i.test(lowerText);

    if (isDomainLockFast) {
        console.log(`⚡ Fast-path domain lock match: "${lowerText}"`);
        return {
            action: "quick_ticket",
            issue_type: "domain_lock",
            needs_troubleshooting: false
        };
    }
    if (isPasswordResetFast) {
        console.log(`⚡ Fast-path password reset match: "${lowerText}"`);
        return {
            action: "quick_ticket",
            issue_type: "password_reset",
            needs_troubleshooting: false
        };
    }

    // 2. Full IT Assistant Prompt
    const prompt = `
You are a concierge IT helpdesk assistant. Analyze: "${redactedMessage}"
Provide JSON ONLY. DO NOT return any other text or explanation. Use this EXACT schema:
{
  "issue_type": "network/printer/password/software/hardware/email/email_otp/email_account_locked/email_session/high_cpu/slow_internet/mfa_failure/vpn/biometric/freshservice/domain_lock/password_reset/social_media_access/social_media_issue/general_question",
  "needs_troubleshooting": true,
  "urgency": "medium",
  "suggested_article": null,
  "direct_answer": "friendly response",
  "action": "create_ticket/troubleshoot/answer/quick_ticket/clarification_needed"
}
Rules:
- HIGHEST PRIORITY: If user provides vague inputs like "error showing on page", "notification not received", "error", or "it's not working" without specifying the context or application, action="clarification_needed".
- HIGHEST PRIORITY: If user mentions "OTP not received", "verification code not received", "OTP issue" (including for Zoho, Outlook, Gmail), action="troubleshoot" and issue_type="email_otp". Do NOT classify as software_install.
- If user says their email account is "locked" or "blocked" (e.g. "email account locked", "zoho mail locked"), action="troubleshoot" and issue_type="email_account_locked". Do NOT raise a domain_lock ticket for email lock issues.
- If user says "email session expired", "keeps logging out of email", "email session timeout", action="troubleshoot" and issue_type="email_session".
- If user mentions "high CPU", "CPU usage high", "CPU 100%", action="troubleshoot" and issue_type="high_cpu".
- If user mentions "slow internet", "internet slow", "internet lagging", "poor network speed", action="troubleshoot" and issue_type="slow_internet".
- If user mentions "MFA not working", "authenticator code wrong", "2FA failure", "multi-factor authentication failure", action="troubleshoot" and issue_type="mfa_failure".
- SECOND PRIORITY: If user mentions "software installation" / "install [software]" (e.g. "install forticlient vpn"), action="quick_ticket" and issue_type="software_install". Do not categorize as "vpn" or "software". BUT if the user says they "already installed" it or are having "login issues", it is NOT an install request; classify as "troubleshoot" and issue_type="software".
- If user mentions "domain lock" (NOT email lock), "password reset", or wants to "provide/grant/request/get biometric access" (NOT a biometric device problem), action="quick_ticket".
- If user wants "access to WhatsApp/Instagram/social media" (NOT an app crash/issue), action="quick_ticket" and issue_type="social_media_access".
- If user says a social media or messaging app "is not working", "crashing", or "has an issue", action="troubleshoot" and issue_type="social_media_issue".
- If user asks to "create a ticket/raise issue/human", action="create_ticket".
- If user provides shorthand issue with a location (e.g., "Keyboard issue, HL, ground floor - Kollu"), action="create_ticket" and issue_type="hardware".
- Shorthand: "net" -> "network", "syn" -> "sync issues", "drive" -> "software", "mouse" -> "hardware", "keyboard" -> "hardware", "bio" -> "biometric", "insta" -> "social_media_issue".
- For specific app issues (like "Slack login issue", "Teams error"), action="troubleshoot", issue_type="software", needs_troubleshooting=true. Do NOT classify app logins as domain_lock or password_reset.
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
            const timeoutDuration = provider === 'ollama' ? 30000 : 5000; // Increased Ollama timeout to 30s
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
            
            // Validate required fields
            if (!parsed.action || !parsed.issue_type) {
                throw new Error("Parsed JSON is missing required fields (action or issue_type)");
            }

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
            const prompt = `Generate 5 structured, basic IT troubleshooting steps for: "${redactedIssue}". The steps MUST be extremely simple and easy for a non-technical end-user to follow. Do NOT suggest advanced tools like Event Viewer, BIOS, Registry Editor, or Command Prompt. Focus on safe, standard user actions like restarting the application/computer, checking physical cables, basic settings, or closing heavy apps. Return ONLY a JSON array of 5 objects with "title", "actions" (array), and "expected_result".`;

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

const classifyL2Ticket = async (chatHistory) => {
    const redactedHistory = privacyService.redact(chatHistory);

    const prompt = `
You are an IT Support L2 routing agent. Analyze the following conversation history between an employee and the L1 helpdesk bot.
Determine the correct L2 team queue to assign the ticket to, the severity of the issue, and create a structured technical summary.

Available L2 Teams:
- NetOps: Handles network issues, WiFi, VPN connection errors, DNS slowness, firewall blockages.
- SysAdmin: Handles operating system problems, file permissions, server crashes, domain login/account issues.
- SecOps: Handles phishing alerts, compromised accounts, security software alerts, MFA reset issues.
- DevOps: Handles cloud infrastructure, pipeline deployments, database errors, model/dataset download issues.
- Hardware: Handles physical devices, keyboards, mice, printers, docking stations.

Provide your response in JSON ONLY. DO NOT return any other text, markdown blocks, or explanation.
Use this EXACT JSON schema:
{
  "l2_group": "NetOps/SysAdmin/SecOps/DevOps/Hardware",
  "priority": "Low/Medium/High/Critical",
  "structured_summary": "Provide a 2-3 sentence technical summary of the issue, steps tried, and error messages."
}

Conversation History:
"""
${redactedHistory}
"""
`;

    // Try providers in priority order
    for (const provider of config.priority) {
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
                                { role: "system", content: "You are an L2 routing agent. JSON ONLY." },
                                { role: "user", content: `[INST] ${prompt} [/INST]` }
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
                                { role: "system", content: "You are an L2 routing agent. JSON ONLY." },
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
            console.log(`PARSED L2 CLASSIFICATION (${provider.toUpperCase()}):`, parsed);
            return parsed;
        } catch (e) {
            console.error(`${provider} L2 classification failed:`, e.message);
        }
    }

    // Default Fallback
    console.warn("⚠️ All AI L2 classifiers failed. Using fallback routing.");
    let group = "SysAdmin";
    const lowerHistory = redactedHistory.toLowerCase();
    if (lowerHistory.includes('vpn') || lowerHistory.includes('net') || lowerHistory.includes('wifi') || lowerHistory.includes('dns')) {
        group = "NetOps";
    } else if (lowerHistory.includes('printer') || lowerHistory.includes('mouse') || lowerHistory.includes('keyboard')) {
        group = "Hardware";
    } else if (lowerHistory.includes('phish') || lowerHistory.includes('malware') || lowerHistory.includes('hack') || lowerHistory.includes('mfa')) {
        group = "SecOps";
    } else if (lowerHistory.includes('docker') || lowerHistory.includes('database') || lowerHistory.includes('aws') || lowerHistory.includes('model')) {
        group = "DevOps";
    }

    return {
        l2_group: group,
        priority: "Medium",
        structured_summary: `Escalated ticket based on conversation history: "${redactedHistory.substring(0, 150)}..."`
    };
};

module.exports = { detectIntent, generateDynamicSteps, generateResponse, classifyL2Ticket };
