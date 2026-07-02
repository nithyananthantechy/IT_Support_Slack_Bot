const fs = require('fs-extra');
const path = require('path');
const documentParser = require('./documentParser');

const ARTICLES_DIR = path.join(__dirname, '../articles');
let articlesCache = [];

/**
 * Load all articles from the articles directory
 */
const loadArticles = async () => {
    try {
        await fs.ensureDir(ARTICLES_DIR);
        const files = await fs.readdir(ARTICLES_DIR);

        const loadedArticles = [];
        for (const file of files) {
            const filePath = path.join(ARTICLES_DIR, file);
            try {
                const content = await documentParser.parseDocument(filePath);

                // Try to parse metadata if it's JSON
                let metadata = {};
                if (file.endsWith('.json')) {
                    try {
                        const jsonContent = JSON.parse(await fs.readFile(filePath, 'utf-8'));
                        metadata = {
                            title: jsonContent.title || file,
                            keywords: jsonContent.keywords || [],
                            issue_type: jsonContent.issue_type || 'general',
                            steps: jsonContent.steps || []
                        };
                    } catch (e) {
                        // If parsing fails here, it might have been parsed by documentParser as string
                    }
                }

                loadedArticles.push({
                    id: file,
                    content,
                    ...metadata
                });
            } catch (error) {
                console.error(`Failed to load article ${file}:`, error);
            }
        }
        articlesCache = loadedArticles;
        console.log(`Loaded ${articlesCache.length} articles into Knowledge Base.`);
    } catch (error) {
        console.error("Error loading articles:", error);
    }
};

const findArticle = (issueTypeOrQuery) => {
    if (!issueTypeOrQuery) return null;

    const query = issueTypeOrQuery.toLowerCase().trim();
    const queryWords = query.split(/\s+/).filter(w => w.length > 2); // Only care about 3+ char words for fuzzy

    // 1. Try exact issue_type match first
    const exactMatch = articlesCache.find(a => a.issue_type === issueTypeOrQuery);
    if (exactMatch) {
        console.log(`✅ Found exact match by issue_type: ${exactMatch.title}`);
        return exactMatch;
    }

    // 2. Scored Keyword Matching
    const scoredMatches = articlesCache.map(article => {
        if (!article.keywords || article.keywords.length === 0) return { article, score: 0 };

        let score = 0;
        article.keywords.forEach(keyword => {
            const kw = keyword.toLowerCase();

            // 1. Exact full phrase match (highest weight)
            if (query === kw) {
                score += 15;
            }
            // 2. Query contains keyword (e.g. "my net is slow" contains "net")
            // Only if keyword is 3+ chars to avoid matching "i" or "ai" accidentally
            else if (query.includes(kw) && kw.length >= 3) {
                score += 10;
            }
            // 3. Keyword contains query (e.g. "syncing" contains "syn")
            // Only if query is 3+ chars to avoid "hi" -> "high cpu"
            else if (kw.includes(query) && query.length >= 3) {
                score += 5;
            }
        });

        // 4. Title similarity matching (High priority)
        const lowerTitle = article.title.toLowerCase();
        const titleWords = lowerTitle.split(/\s+/).filter(w => w.length > 2);

        // Match if query is the title or contains the title's main words
        if (query === lowerTitle) score += 25;
        else if (titleWords.some(w => query.includes(w))) score += 15;
        else if (queryWords.some(w => lowerTitle.includes(w))) score += 12;

        return { article, score };
    });

    const bestMatch = scoredMatches
        .filter(m => m.score > 0)
        .sort((a, b) => b.score - a.score)[0];

    if (bestMatch && bestMatch.score >= 5) {
        console.log(`✅ Found match: ${bestMatch.article.title} (Score: ${bestMatch.score})`);
        return bestMatch.article;
    }

    console.log(`ℹ️ No article found for query: "${issueTypeOrQuery}"`);
    return null;
};

/**
 * Get all available articles
 */
const getAllArticles = () => {
    return articlesCache;
}

/**
 * Save/Create a JSON article
 */
const saveArticle = async (id, articleData) => {
    const filename = id.endsWith('.json') ? id : `${id}.json`;
    const filePath = path.join(ARTICLES_DIR, filename);
    await fs.writeJson(filePath, articleData, { spaces: 2 });
    await loadArticles();
};

/**
 * Delete an article
 */
const deleteArticle = async (id) => {
    const filePath = path.join(ARTICLES_DIR, id);
    if (await fs.pathExists(filePath)) {
        await fs.remove(filePath);
        await loadArticles();
        return true;
    }
    return false;
};

module.exports = {
    loadArticles,
    findArticle,
    getAllArticles,
    saveArticle,
    deleteArticle
};
