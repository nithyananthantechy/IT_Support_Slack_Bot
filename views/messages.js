/**
 * Welcome message block
 */
const welcomeMessage = (userId) => {
    return [
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: `Hi there! I'm your IT Helpdesk Assistant. How can I help you today?`
            }
        }
    ];
};

/**
 * Step-by-step troubleshooting message
 * @param {string} stepText 
 * @param {number} currentStep 
 * @param {number} totalSteps 
 * @param {string} articleId
 */
const troubleshootingStep = (stepText, currentStep, totalSteps, articleId) => {
    return [
        {
            type: "header",
            text: {
                type: "plain_text",
                text: `Troubleshooting Step ${currentStep}/${totalSteps}`,
                emoji: true
            }
        },
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: stepText
            }
        },
        {
            type: "actions",
            elements: [
                {
                    type: "button",
                    text: {
                        type: "plain_text",
                        text: "✅ It worked!",
                        emoji: true
                    },
                    style: "primary",
                    action_id: "step_solved",
                    value: JSON.stringify({ articleId, step: currentStep })
                },
                {
                    type: "button",
                    text: {
                        type: "plain_text",
                        text: "❌ Still having issues",
                        emoji: true
                    },
                    style: "danger",
                    action_id: "step_failed",
                    value: JSON.stringify({ articleId, step: currentStep })
                }
            ]
        }
    ];
};

/**
 * Ticket created confirmation
 * @param {string} ticketId 
 */
const ticketCreated = (ticketId) => {
    return [
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: `I've created a support ticket for you. *Ticket #${ticketId}*`
            }
        },
        {
            type: "context",
            elements: [
                {
                    type: "mrkdwn",
                    text: "An IT support agent will reach out to you shortly."
                }
            ]
        }
    ];
};

/**
 * Button to open the details modal
 * @param {string} text - The context message to show above the button
 */
const requestDetailsButton = (text) => {
    return [
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: text
            }
        },
        {
            type: "actions",
            elements: [
                {
                    type: "button",
                    text: {
                        type: "plain_text",
                        text: "🔒 Provide Details",
                        emoji: true
                    },
                    style: "primary",
                    action_id: "open_details_modal"
                }
            ]
        }
    ];
};

/**
 * Selection buttons for Personal vs Company laptop
 * @param {string} text - Message context
 */
const laptopTypeSelection = (text) => {
    return [
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: text
            }
        },
        {
            type: "actions",
            elements: [
                {
                    type: "button",
                    text: {
                        type: "plain_text",
                        text: "💻 Personal Laptop",
                        emoji: true
                    },
                    style: "primary",
                    action_id: "personal_laptop_install"
                },
                {
                    type: "button",
                    text: {
                        type: "plain_text",
                        text: "🏢 Company Laptop",
                        emoji: true
                    },
                    action_id: "company_laptop_install"
                }
            ]
        }
    ];
};

module.exports = {
    welcomeMessage,
    troubleshootingStep,
    ticketCreated,
    requestDetailsButton,
    laptopTypeSelection
};
