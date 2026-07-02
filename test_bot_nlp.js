const aiService = require('./services/aiService');

const testCases = [
    "pls unlock my domain",
    "pass wrod rset",
    "i forgot my password",
    "my biometric is not registering",
    "bio access needed",
    "keyboard stuck, third floor desk 5",
    "mouse broken at HL",
    "i need a new laptop",
    "how do i request software",
    "my wifi is disconnected",
    "no internet",
    "i want to raise a ticket for my broken screen",
    "hello there helpdesk",
    "hi i need help with my monitor",
    "vpn is dropping",
    "can't access freshservice",
    "why is my computer so slow"
];

async function runTests() {
    console.log("🚀 Starting Bot NLP Intent Tests...\n");
    for (const test of testCases) {
        console.log(`\n======================================`);
        console.log(`User Input: "${test}"`);
        try {
            const start = Date.now();
            const result = await aiService.detectIntent(test);
            const duration = Date.now() - start;
            console.log(`AI Result:`, JSON.stringify(result, null, 2));
            console.log(`⏱️ Response Time: ${duration}ms`);
        } catch (error) {
            console.error(`❌ Error testing "${test}":`, error.message);
        }
    }
    console.log(`\n✅ Testing Complete!`);
    process.exit(0);
}

runTests();
