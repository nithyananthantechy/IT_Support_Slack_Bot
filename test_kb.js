const knowledgeBase = require('./services/knowledgeBase');

const tests = [
    { query: "Screen size issue", expectedTitle: "Screen Size and Display Issues" },
    { query: "Permissions not working FOR mic", expectedTitle: "Microphone Permissions & Issues" },
    { query: "Data not saving in my laptop", expectedTitle: "Data Not Saving" },
    { query: "Timeout errors", expectedTitle: "Connection Timeout Errors" },
    { query: "File download failed", expectedTitle: "File Download Failed" },
    { query: "Laptop power on issue", expectedTitle: "Laptop Won't Power On" },
    { query: "Battery draining quickly", expectedTitle: "Battery Draining Quickly" },
    { query: "Search not returning results", expectedTitle: "Search Not Returning Results" }
];

(async () => {
    console.log("Loading articles...");
    await knowledgeBase.loadArticles();
    console.log("\n========== Knowledge Base Retrieval Tests ==========\n");

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
        const article = knowledgeBase.findArticle(test.query);
        const actualTitle = article ? article.title : "None";

        if (actualTitle === test.expectedTitle) {
            console.log(`✅ PASS | "${test.query}" -> ${actualTitle}`);
            passed++;
        } else {
            console.log(`❌ FAIL | "${test.query}"`);
            console.log(`         Expected: ${test.expectedTitle}`);
            console.log(`         Got:      ${actualTitle}`);
            failed++;
        }
    }

    console.log(`\n========== Results: ${passed} passed, ${failed} failed ==========`);
})();
