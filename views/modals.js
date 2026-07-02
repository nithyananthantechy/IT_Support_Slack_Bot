const reportIssueModal = (triggerId, initialDescription = "") => {
    return {
        type: 'modal',
        callback_id: 'submit_issue',
        title: {
            type: 'plain_text',
            text: 'Report an IT Issue'
        },
        submit: {
            type: 'plain_text',
            text: 'Submit'
        },
        close: {
            type: 'plain_text',
            text: 'Cancel'
        },
        blocks: [
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: 'Please describe your issue in detail. I will try to help you fix it, or create a ticket if needed.'
                }
            },
            {
                type: 'input',
                block_id: 'issue_description_block',
                element: {
                    type: 'plain_text_input',
                    action_id: 'issue_description',
                    multiline: true,
                    initial_value: initialDescription
                },
                label: {
                    type: 'plain_text',
                    text: 'Description'
                }
            },
            {
                type: 'input',
                block_id: 'issue_type_block',
                element: {
                    type: 'static_select',
                    action_id: 'issue_type',
                    placeholder: {
                        type: 'plain_text',
                        text: 'Select issue type'
                    },
                    options: [
                        {
                            text: { type: 'plain_text', text: 'Network / Internet' },
                            value: 'network'
                        },
                        {
                            text: { type: 'plain_text', text: 'Hardware (Printer, Laptop)' },
                            value: 'hardware'
                        },
                        {
                            text: { type: 'plain_text', text: 'Software / Access' },
                            value: 'software'
                        },
                        {
                            text: { type: 'plain_text', text: 'Other' },
                            value: 'other'
                        }
                    ]
                },
                label: {
                    type: 'plain_text',
                    text: 'Category'
                }
            }
        ]
    };
};

const collectDetailsModal = (requiresHostname = false, isSoftwareInstall = false) => {
    const blocks = [];

    if (isSoftwareInstall) {
        blocks.push({
            type: 'context',
            elements: [
                {
                    type: 'mrkdwn',
                    text: '💡 *Note:* If you are using a *personal laptop*, IT approval is not needed. You can close this form and select "Personal Laptop" to get the steps.'
                }
            ]
        });
    }

    blocks.push(
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: 'Please provide your details below. *This information will be kept private.*'
            }
        },
        {
            type: 'input',
            block_id: 'emp_id_block',
            element: {
                type: 'plain_text_input',
                action_id: 'emp_id'
            },
            label: {
                type: 'plain_text',
                text: 'Employee ID'
            }
        },
        {
            type: 'input',
            block_id: 'location_block',
            element: {
                type: 'plain_text_input',
                action_id: 'location'
            },
            label: {
                type: 'plain_text',
                text: 'Location'
            }
        },
        {
            type: 'input',
            block_id: 'email_block',
            element: {
                type: 'plain_text_input',
                action_id: 'email'
            },
            label: {
                type: 'plain_text',
                text: 'Email Address'
            }
        }
    );

    if (requiresHostname) {
        blocks.push({
            type: 'input',
            block_id: 'hostname_block',
            element: {
                type: 'plain_text_input',
                action_id: 'hostname'
            },
            label: {
                type: 'plain_text',
                text: 'System Hostname (e.g. DC-KO-UB-RL-001)'
            },
            hint: {
                type: 'plain_text',
                text: 'Format: DC-[Location]-[Type]-[Floor]-[Number] | Location codes: KO = Kollumangudi, TN = TN Palayam, KA = Kaup, VPM = Villupuram, etc. | To find it: Open Command Prompt and type: hostname'
            }
        });
    }

    return {
        type: 'modal',
        callback_id: 'submit_details',
        // Private metadata allows us to pass custom contextual flags directly to the view submission handler
        private_metadata: JSON.stringify({ requiresHostname }),
        title: {
            type: 'plain_text',
            text: 'Provide Details'
        },
        submit: {
            type: 'plain_text',
            text: 'Submit'
        },
        close: {
            type: 'plain_text',
            text: 'Cancel'
        },
        blocks: blocks
    };
};

module.exports = { reportIssueModal, collectDetailsModal };
