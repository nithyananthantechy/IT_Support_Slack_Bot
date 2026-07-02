const axios = require('axios');
const fs = require('fs-extra');
require('dotenv').config();

const FRESHSERVICE_DOMAIN = process.env.FRESHSERVICE_DOMAIN;
const FRESHSERVICE_API_KEY = process.env.FRESHSERVICE_API_KEY;

/**
 * createTicket
 * Creates a ticket in Freshservice
 * @param {object} ticketData 
 * @returns {Promise<object>}
 */
const createTicket = async (ticketData) => {
    if (!FRESHSERVICE_DOMAIN || !FRESHSERVICE_API_KEY) {
        console.warn("Freshservice credentials not found. Mocking ticket creation.");
        return {
            id: Math.floor(Math.random() * 10000),
            subject: ticketData.subject,
            description: ticketData.description,
            status: 2,
            priority: 1
        };
    }

    try {
        const response = await axios.post(`https://${FRESHSERVICE_DOMAIN}/api/v2/tickets`, {
            description: ticketData.description,
            subject: ticketData.subject,
            email: ticketData.email,
            name: ticketData.name || "Slack User",
            priority: 1,
            status: 2,
            source: 2, // Portal
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${Buffer.from(FRESHSERVICE_API_KEY + ':X').toString('base64')}`
            }
        });
        return response.data.ticket;
    } catch (error) {
        console.error("Error creating Freshservice ticket:", error.response ? error.response.data : error.message);
        throw new Error("Failed to create ticket.");
    }
};

/**
 * getTicketConversations
 * Fetches all conversations/notes for a ticket
 * @param {string|number} ticketId - Freshservice ticket ID
 * @returns {Promise<array>} - Array of conversation objects
 */
const getTicketConversations = async (ticketId) => {
    if (!FRESHSERVICE_DOMAIN || !FRESHSERVICE_API_KEY) {
        console.warn("Freshservice credentials not found. Returning mock conversations.");
        return [
            {
                id: 1,
                body: "Thank you for reaching out to DC IT Helpdesk. Your request has been processed.",
                body_text: "Thank you for reaching out to DC IT Helpdesk. Your request has been processed.",
                incoming: false,
                user_id: 1,
                created_at: new Date().toISOString()
            }
        ];
    }

    try {
        const response = await axios.get(`https://${FRESHSERVICE_DOMAIN}/api/v2/tickets/${ticketId}/conversations`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${Buffer.from(FRESHSERVICE_API_KEY + ':X').toString('base64')}`
            }
        });
        return response.data.conversations || [];
    } catch (error) {
        console.error("Error fetching ticket conversations:", error.response ? error.response.data : error.message);
        return [];
    }
};

/**
 * getLatestTicketReply
 * Gets the most recent public reply/note from support team
 * @param {string|number} ticketId - Freshservice ticket ID
 * @returns {Promise<string|null>} - Latest reply text or null
 */
const getLatestTicketReply = async (ticketId) => {
    try {
        const conversations = await getTicketConversations(ticketId);

        if (!conversations || conversations.length === 0) {
            return null;
        }

        // Sort by created_at descending to get the latest
        const sorted = conversations.sort((a, b) =>
            new Date(b.created_at) - new Date(a.created_at)
        );

        // Find the latest public note (not from customer)
        const latestReply = sorted.find(conv => !conv.incoming && conv.body_text);

        return latestReply ? latestReply.body_text : null;
    } catch (error) {
        console.error("Error getting latest ticket reply:", error);
        return null;
    }
};

/**
 * addTicketNote
 * Adds a note/comment to a Freshservice ticket
 * @param {string|number} ticketId 
 * @param {string} noteText 
 * @param {boolean} isPrivate 
 * @returns {Promise<object>}
 */
const addTicketNote = async (ticketId, noteText, isPrivate = false, attachments = []) => {
    if (!FRESHSERVICE_DOMAIN || !FRESHSERVICE_API_KEY) {
        console.warn("Freshservice credentials not found. Mocking note addition.");
        return {
            id: Math.floor(Math.random() * 10000),
            body: noteText,
            private: isPrivate,
            created_at: new Date().toISOString()
        };
    }

    try {
        let response;
        if (attachments && attachments.length > 0) {
            const formData = new FormData();
            formData.append('body', noteText);
            formData.append('private', String(isPrivate));

            for (const att of attachments) {
                const blob = new Blob([att.data], { type: att.mimeType });
                const file = new File([blob], att.filename, { type: att.mimeType });
                formData.append('attachments[]', file);
            }

            response = await axios.post(`https://${FRESHSERVICE_DOMAIN}/api/v2/tickets/${ticketId}/notes`, formData, {
                headers: {
                    'Authorization': `Basic ${Buffer.from(FRESHSERVICE_API_KEY + ':X').toString('base64')}`
                }
            });
        } else {
            response = await axios.post(`https://${FRESHSERVICE_DOMAIN}/api/v2/tickets/${ticketId}/notes`, {
                body: noteText,
                private: isPrivate
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${Buffer.from(FRESHSERVICE_API_KEY + ':X').toString('base64')}`
                }
            });
        }
        return response.data.note;
    } catch (error) {
        console.error("Error adding ticket note:", error.response ? error.response.data : error.message);
        throw new Error("Failed to add note.");
    }
};

module.exports = {
    createTicket,
    getTicketConversations,
    getLatestTicketReply,
    addTicketNote
};
