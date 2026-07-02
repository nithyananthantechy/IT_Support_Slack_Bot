const express = require('express');
const router = express.Router();
const knowledgeBase = require('./knowledgeBase');
const analyticsService = require('./analyticsService');
const aiConfig = require('../config/ai');

// GET /api/admin/analytics
router.get('/analytics', async (req, res) => {
    try {
        const stats = await analyticsService.getAnalytics();
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/admin/articles
router.get('/articles', (req, res) => {
    try {
        const articles = knowledgeBase.getAllArticles();
        res.json(articles);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/admin/articles
router.post('/articles', async (req, res) => {
    try {
        const { id, title, keywords, issue_type, steps } = req.body;
        if (!id || !title || !steps) {
            return res.status(400).json({ error: "Missing required fields (id, title, steps)" });
        }
        const articleData = { title, keywords: keywords || [], issue_type: issue_type || 'general', steps };
        await knowledgeBase.saveArticle(id, articleData);
        res.json({ message: "Article saved successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/admin/articles/:id
router.delete('/articles/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await knowledgeBase.deleteArticle(id);
        if (deleted) {
            res.json({ message: "Article deleted successfully" });
        } else {
            res.status(404).json({ error: "Article not found" });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/admin/config
router.get('/config', (req, res) => {
    res.json({
        provider: aiConfig.provider,
        priority: aiConfig.priority,
        gemini: { model: aiConfig.gemini.model },
        openai: { model: aiConfig.openai.model },
        ollama: { model: aiConfig.ollama.model }
    });
});

// POST /api/admin/config
router.post('/config', (req, res) => {
    try {
        const { provider, priority, geminiModel, openaiModel, ollamaModel } = req.body;
        if (provider) aiConfig.provider = provider;
        if (priority) aiConfig.priority = Array.isArray(priority) ? priority : priority.split(',');
        if (geminiModel) aiConfig.gemini.model = geminiModel;
        if (openaiModel) aiConfig.openai.model = openaiModel;
        if (ollamaModel) aiConfig.ollama.model = ollamaModel;
        res.json({ message: "Configuration updated successfully", config: aiConfig });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
