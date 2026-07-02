const fs = require('fs-extra');
const path = require('path');

const ANALYTICS_FILE = path.join(__dirname, '../data/analytics.json');

// Synchronous initialization to prevent race conditions on startup
const initFileSync = () => {
    try {
        fs.ensureDirSync(path.dirname(ANALYTICS_FILE));
        if (!fs.existsSync(ANALYTICS_FILE)) {
            fs.writeJsonSync(ANALYTICS_FILE, {
                tickets: [],
                deflections: []
            }, { spaces: 2 });
        }
    } catch (err) {
        console.error("Failed to initialize analytics file:", err);
    }
};

// Seed initial data synchronously
const seedInitialDataSync = () => {
    try {
        initFileSync();
        const currentData = fs.readJsonSync(ANALYTICS_FILE);

        // Only seed if empty or very small
        if (currentData.tickets.length === 0 && currentData.deflections.length === 0) {
            console.log("🌱 Seeding initial demonstration analytics data...");
            const now = new Date();
            const daysAgo = (d) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString();

            const mockTickets = [
                { ticketId: 101, userId: 'U12345', ticketType: 'domain_lock', timestamp: daysAgo(5) },
                { ticketId: 102, userId: 'U67890', ticketType: 'hardware', timestamp: daysAgo(4) },
                { ticketId: 103, userId: 'U12345', ticketType: 'password_reset', timestamp: daysAgo(3) },
                { ticketId: 104, userId: 'U34567', ticketType: 'network', timestamp: daysAgo(2) },
                { ticketId: 105, userId: 'U90123', ticketType: 'software', timestamp: daysAgo(1) }
            ];

            const mockDeflections = [
                { userId: 'U12345', articleIdOrTopic: 'google_meet_troubleshoot.json', source: 'kb', timestamp: daysAgo(6) },
                { userId: 'U67890', articleIdOrTopic: 'direct_answer', source: 'direct_answer', timestamp: daysAgo(5) },
                { userId: 'U34567', articleIdOrTopic: 'adobe_pdf_issues.json', source: 'kb', timestamp: daysAgo(4) },
                { userId: 'U90123', articleIdOrTopic: 'direct_answer', source: 'direct_answer', timestamp: daysAgo(3) },
                { userId: 'U12345', articleIdOrTopic: 'folder_permission_fix.json', source: 'kb', timestamp: daysAgo(2) },
                { userId: 'U11111', articleIdOrTopic: 'linux_service_restart.json', source: 'kb', timestamp: daysAgo(1) },
                { userId: 'U22222', articleIdOrTopic: 'direct_answer', source: 'direct_answer', timestamp: daysAgo(0.5) }
            ];

            fs.writeJsonSync(ANALYTICS_FILE, {
                tickets: mockTickets,
                deflections: mockDeflections
            }, { spaces: 2 });
            console.log("🌱 Seeding complete!");
        }
    } catch (e) {
        console.error("Error seeding analytics data:", e);
    }
};

// Seed immediately on import (synchronously, so it finishes before any other methods run)
seedInitialDataSync();

// Log a ticket creation
const logTicket = async (ticketId, userId, ticketType) => {
    try {
        const data = await fs.readJson(ANALYTICS_FILE);
        data.tickets.push({
            ticketId,
            userId,
            ticketType: ticketType || 'general',
            timestamp: new Date().toISOString()
        });
        await fs.writeJson(ANALYTICS_FILE, data, { spaces: 2 });
    } catch (err) {
        console.error("Error logging ticket analytics:", err);
    }
};

// Log a deflection event (issue solved by AI or KB)
const logDeflection = async (userId, articleIdOrTopic, source) => {
    try {
        const data = await fs.readJson(ANALYTICS_FILE);
        data.deflections.push({
            userId,
            articleIdOrTopic: articleIdOrTopic || 'direct_answer',
            source: source || 'kb', // 'kb' or 'direct_answer'
            timestamp: new Date().toISOString()
        });
        await fs.writeJson(ANALYTICS_FILE, data, { spaces: 2 });
    } catch (err) {
        console.error("Error logging deflection analytics:", err);
    }
};

// Get aggregated analytics
const getAnalytics = async () => {
    try {
        const data = await fs.readJson(ANALYTICS_FILE);

        const totalTickets = data.tickets.length;
        const totalDeflections = data.deflections.length;
        const totalQueries = totalTickets + totalDeflections;

        const deflectionRate = totalQueries > 0 ? Math.round((totalDeflections / totalQueries) * 100) : 0;

        // Count categories for tickets
        const ticketCategories = {};
        data.tickets.forEach(t => {
            ticketCategories[t.ticketType] = (ticketCategories[t.ticketType] || 0) + 1;
        });

        // Count categories for deflections
        const deflectionCategories = {};
        data.deflections.forEach(d => {
            const cat = d.articleIdOrTopic.replace('.json', '').replace('dynamic_', 'AI Custom: ');
            deflectionCategories[cat] = (deflectionCategories[cat] || 0) + 1;
        });

        // Recent activity (merge and sort recent events)
        const recentTickets = data.tickets.slice(-5).map(t => ({ ...t, type: 'ticket' }));
        const recentDeflections = data.deflections.slice(-5).map(d => ({ ...d, type: 'deflection' }));
        const recentActivity = [...recentTickets, ...recentDeflections]
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, 5);

        return {
            totalTickets,
            totalDeflections,
            deflectionRate,
            ticketCategories,
            deflectionCategories,
            recentActivity
        };
    } catch (err) {
        console.error("Error getting analytics:", err);
        return {
            totalTickets: 0,
            totalDeflections: 0,
            deflectionRate: 0,
            ticketCategories: {},
            deflectionCategories: {},
            recentActivity: []
        };
    }
};

module.exports = {
    logTicket,
    logDeflection,
    getAnalytics
};
