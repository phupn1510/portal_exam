// AI Service - Multi-provider AI for answer explanations
import OpenAI from 'openai';

class AIService {
    constructor() {
        this.openai = null;
        this.geminiKey = process.env.GEMINI_API_KEY;
        
        if (process.env.OPENAI_API_KEY) {
            this.openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY
            });
        }
    }

    async explainAnswer(question, selectedAnswer, provider = 'openai') {
        const prompt = this.buildPrompt(question, selectedAnswer);
        
        switch (provider) {
            case 'openai':
                return await this.explainWithOpenAI(prompt);
            case 'gemini':
                return await this.explainWithGemini(prompt);
            case 'opencode':
                return await this.explainWithOpenCode(question, selectedAnswer);
            default:
                return await this.explainWithOpenAI(prompt);
        }
    }

    buildPrompt(question, selectedAnswer) {
        return `
Hãy giải thích câu hỏi tiếng Anh lớp 2 sau và cho biết đáp án đúng là gì:

Câu hỏi: ${question.text}
Các lựa chọn: ${question.options.map(o => `${o.letter}. ${o.text}`).join(', ')}
Đáp án đã chọn: ${selectedAnswer ? `${selectedAnswer.letter}. ${selectedAnswer.text}` : 'Chưa chọn'}

Hãy giải thích:
1. Đáp án đúng là gì?
2. Tại sao đáp án đó đúng?
3. Giải thích ngắn gọn bằng tiếng Việt để học sinh lớp 2 có thể hiểu

`;
    }

    async explainWithOpenAI(prompt) {
        if (!this.openai) {
            return { error: 'OpenAI not configured', provider: 'openai' };
        }

        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-3.5-turbo',
                messages: [
                    { 
                        role: 'system', 
                        content: 'Bạn là một giáo viên tiếng Anh cho học sinh lớp 2. Hãy giải thích ngắn gọn, dễ hiểu.' 
                    },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 500,
                temperature: 0.7
            });

            return {
                explanation: response.choices[0].message.content,
                provider: 'openai',
                model: 'gpt-3.5-turbo'
            };
        } catch (error) {
            console.error('OpenAI error:', error);
            return { error: error.message, provider: 'openai' };
        }
    }

    async explainWithGemini(prompt) {
        if (!this.geminiKey) {
            return { error: 'Gemini not configured', provider: 'gemini' };
        }

        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${this.geminiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            temperature: 0.7,
                            maxOutputTokens: 500
                        }
                    })
                }
            );

            const data = await response.json();
            
            if (data.candidates && data.candidates[0]) {
                return {
                    explanation: data.candidates[0].content.parts[0].text,
                    provider: 'gemini',
                    model: 'gemini-pro'
                };
            }
            
            return { error: 'No response from Gemini', provider: 'gemini' };
        } catch (error) {
            console.error('Gemini error:', error);
            return { error: error.message, provider: 'gemini' };
        }
    }

    async explainWithOpenCode(question, selectedAnswer) {
        // This would integrate with OpenCode's AI
        // For now, return instructions
        return {
            explanation: `Để sử dụng AI của OpenCode cho câu hỏi này, vui lòng cấu hình API key trong .env file.`,
            provider: 'opencode',
            note: 'Cần tích hợp OpenCode API'
        };
    }

    // Batch explain for multiple questions
    async explainBatch(questions, selectedAnswers, provider = 'openai') {
        const results = [];
        
        for (let i = 0; i < questions.length; i++) {
            const result = await this.explainAnswer(
                questions[i], 
                selectedAnswers[i], 
                provider
            );
            results.push({
                questionId: questions[i].id,
                ...result
            });
            
            // Rate limiting
            if (i < questions.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        return results;
    }
}

export default new AIService();
