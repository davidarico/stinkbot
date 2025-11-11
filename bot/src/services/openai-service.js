class OpenAIService {
    constructor(openaiClient) {
        this.openai = openaiClient;
    }

    /**
     * Generate a funny response for unknown commands
     */
    async generateFunnyResponse(command, username) {
        if (!this.openai) {
            return null;
        }

        try {
            const prompt = `You are a Discord bot for a Werewolf (mafia) game. A user tried to use an unknown command: "${command}".
                Generate a funny, short response (1-2 sentences max) that:
                - Is playful and slightly sarcastic
                - Is a possible response to the command
                - Keeps the tone light and entertaining
                - Doesn't exceed 2 sentences
                - Crass and vulgar language is allowed

                Do not allude to the fact that the command is unknown.
            `;

            const response = await this.openai.chat.completions.create({
                model: 'gpt-3.5-turbo',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a sassy Discord bot that responds to unknown commands with short, funny messages that could be a possible response to the command.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 100,
                temperature: 0.8
            });

            const content = response.choices[0]?.message?.content?.trim() || null;
            if (!content) return null;

            // Remove extra quotes from the beginning and end of the response
            let cleanedContent = content;

            // Remove quotes from the beginning
            while (cleanedContent.startsWith('"') || cleanedContent.startsWith('"') || cleanedContent.startsWith("'") || cleanedContent.startsWith("'")) {
                cleanedContent = cleanedContent.slice(1);
            }

            // Remove quotes from the end
            while (cleanedContent.endsWith('"') || cleanedContent.endsWith('"') || cleanedContent.endsWith("'") || cleanedContent.endsWith("'")) {
                cleanedContent = cleanedContent.slice(0, -1);
            }

            return cleanedContent;
        } catch (error) {
            console.error('Error generating OpenAI response:', error);
            return null;
        }
    }
}

module.exports = OpenAIService;
