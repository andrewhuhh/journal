const functions = require('firebase-functions');
const cors = require('cors')({ origin: true });
const fetch = require('node-fetch');

exports.generateInsights = functions.https.onRequest((request, response) => {
    cors(request, response, async () => {
        try {
            // Verify authentication
            if (!request.headers.authorization) {
                throw new Error('No API key provided');
            }
            const apiKey = request.headers.authorization.split('Bearer ')[1];

            // Get data from request
            const { prompt, weekData, previousWeekData } = request.body;

            console.log('Generating insights with prompt:', prompt);

            try {
                // Call Anthropic API
                const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey,
                        'anthropic-version': '2023-06-01'
                    },
                    body: JSON.stringify({
                        model: 'claude-3-haiku-20240307',
                        max_tokens: 500,
                        temperature: 0.7,
                        system: 'your personality is: friendly, casual, but kind, like chatting with a close friend on discord. always write in lowercase letters to maintain an informal vibe. keep responses concise and punchy (2-3 sentences per thought). focus on patterns and changes in the data, but discuss them like a friend would. be encouraging while staying genuine and real. avoid corporate or formal language entirely. use occasional emoji for emphasis, but don\'t overdo it.',
                        messages: [
                            {
                                role: 'user',
                                content: prompt
                            }
                        ]
                    })
                });

                // Handle the response
                const result = await anthropicResponse.json();
                if (!anthropicResponse.ok) {
                    throw new Error(`API call failed: ${result.error?.message || anthropicResponse.statusText}`);
                }

                // Extract the assistant's message
                const assistantMessage = result.content[0].text;
                response.json({ insights: assistantMessage });
            } catch (apiError) {
                console.error('Anthropic API error:', apiError);
                throw new Error(`Anthropic API error: ${apiError.message}`);
            }
        } catch (error) {
            console.error('Error in generateInsights function:', error);
            response.status(500).send(error.message);
        }
    });
}); 