const aiService = require('./services/aiService');

const tests = [
    // Bug 1 fix: Firewall Fox install should NOT mention WPS Office (handled via article fix, not intent)
    { msg: "install firewall fox", expectedAction: "quick_ticket", expectedType: "software_install" },
    { msg: "need to install chrome", expectedAction: "quick_ticket", expectedType: "software_install" },

    // Vague Clarification Matches
    { msg: "notification not received", expectedAction: "clarification_needed", expectedType: "general" },
    { msg: "error showing page", expectedAction: "clarification_needed", expectedType: "general" },
    { msg: "it is not working", expectedAction: "clarification_needed", expectedType: "general" },

    // Fallback/Misc Edge Cases
    // Bug 2 fix: High CPU Usage
    { msg: "high cpu usage", expectedAction: "troubleshoot", expectedType: "high_cpu" },
    { msg: "cpu is running at 100%", expectedAction: "troubleshoot", expectedType: "high_cpu" },
    { msg: "cpu usage high", expectedAction: "troubleshoot", expectedType: "high_cpu" },

    // Bug 3 fix: Slow Internet
    { msg: "slow internet", expectedAction: "troubleshoot", expectedType: "slow_internet" },
    { msg: "internet is very slow today", expectedAction: "troubleshoot", expectedType: "slow_internet" },
    { msg: "internet lagging", expectedAction: "troubleshoot", expectedType: "slow_internet" },

    // Bug 4 fix: WiFi connected but not working (article fix, intent routes to network/wifi)
    { msg: "wifi connected but not working", expectedAction: "troubleshoot", expectedType: "network" },
    { msg: "wi-fi connected but no internet", expectedAction: "troubleshoot", expectedType: "network" },

    // Bug 5 fix: Zoho OTP not received → email_otp (NOT software_install)
    { msg: "zoho mail otp not received", expectedAction: "troubleshoot", expectedType: "email_otp" },
    { msg: "otp not received", expectedAction: "troubleshoot", expectedType: "email_otp" },
    { msg: "not receiving verification code", expectedAction: "troubleshoot", expectedType: "email_otp" },
    { msg: "otp not coming", expectedAction: "troubleshoot", expectedType: "email_otp" },

    // Bug 6 fix: Email Account Locked → email_account_locked troubleshoot (NOT domain_lock quick_ticket)
    { msg: "email account locked", expectedAction: "troubleshoot", expectedType: "email_account_locked" },
    { msg: "my email is locked", expectedAction: "troubleshoot", expectedType: "email_account_locked" },
    { msg: "zoho mail account locked", expectedAction: "troubleshoot", expectedType: "email_account_locked" },
    { msg: "outlook account locked", expectedAction: "troubleshoot", expectedType: "email_account_locked" },

    // Domain Lock should still work for true domain lock (NOT email lock)
    { msg: "domain lock", expectedAction: "quick_ticket", expectedType: "domain_lock" },
    { msg: "my account is locked", expectedAction: "quick_ticket", expectedType: "domain_lock" },

    // New: Email Session Expired
    { msg: "email session expired", expectedAction: "troubleshoot", expectedType: "email_session" },
    { msg: "email keeps signing me out", expectedAction: "troubleshoot", expectedType: "email_session" },

    // New: MFA Failure
    { msg: "mfa not working", expectedAction: "troubleshoot", expectedType: "mfa_failure" },
    { msg: "authenticator code not working", expectedAction: "troubleshoot", expectedType: "mfa_failure" },
    { msg: "2fa code invalid", expectedAction: "troubleshoot", expectedType: "mfa_failure" },
    { msg: "multi-factor authentication failure", expectedAction: "troubleshoot", expectedType: "mfa_failure" },

    // Ensure "zoho install" still routes to software_install (no OTP mentioned)
    { msg: "install zoho crm", expectedAction: "quick_ticket", expectedType: "software_install" },
];

(async () => {
    console.log("\n========== Intent Detection Tests ==========\n");
    let passed = 0;
    let failed = 0;

    for (const test of tests) {
        try {
            const result = await aiService.detectIntent(test.msg);
            const actionOk = result.action === test.expectedAction;
            const typeOk = test.expectedType ? result.issue_type === test.expectedType : true;
            const status = (actionOk && typeOk) ? "✅ PASS" : "❌ FAIL";

            if (actionOk && typeOk) passed++;
            else failed++;

            console.log(`${status} | "${test.msg}"`);
            console.log(`       Expected: action=${test.expectedAction}, type=${test.expectedType}`);
            console.log(`       Got:      action=${result.action}, type=${result.issue_type}`);
            if (!actionOk || !typeOk) {
                console.log(`       ⚠️  MISMATCH!`);
            }
            console.log("");
        } catch (e) {
            console.error(`❌ ERROR | "${test.msg}": ${e.message}\n`);
            failed++;
        }
    }

    console.log(`========== Results: ${passed} passed, ${failed} failed ==========\n`);
})();
