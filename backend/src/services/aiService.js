// AI Service - Multi-provider AI for answer explanations
// Providers: openai | gemini | kimi
import OpenAI from 'openai';

class AIService {
    constructor() {
        // OpenAI client
        this.openai = process.env.OPENAI_API_KEY
            ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
            : null;

        // Kimi K2 (Moonshot AI) — OpenAI-compatible API
        this.kimi = process.env.KIMI_API_KEY
            ? new OpenAI({
                apiKey: process.env.KIMI_API_KEY,
                baseURL: 'https://api.moonshot.cn/v1'
            })
            : null;

        this.geminiKey = process.env.GEMINI_API_KEY;
    }

    // ─── Logging helper ───────────────────────────────────────────────────────

    _logRequest(provider, model, prompt) {
        console.log(`\n📡 [AI REQUEST] provider=${provider} model=${model}`);
        console.log(`   prompt preview: "${prompt.slice(0, 120).replace(/\n/g, ' ')}..."`);
    }

    _logResponse(provider, model, startMs, content) {
        const elapsed = Date.now() - startMs;
        console.log(`✅ [AI RESPONSE] provider=${provider} model=${model} time=${elapsed}ms`);
        console.log(`   response preview: "${(content || '').slice(0, 120).replace(/\n/g, ' ')}..."`);
    }

    _logError(provider, model, startMs, error) {
        const elapsed = Date.now() - startMs;
        console.error(`❌ [AI ERROR] provider=${provider} model=${model} time=${elapsed}ms error=${error.message}`);
    }

    // ─── Main entry ───────────────────────────────────────────────────────────

    async explainAnswer(question, selectedAnswer, provider = 'openai') {
        const prompt = this.buildPrompt(question, selectedAnswer);

        switch (provider) {
            case 'openai':  return await this.explainWithOpenAI(prompt);
            case 'gemini':  return await this.explainWithGemini(prompt);
            case 'kimi':    return await this.explainWithKimi(prompt);
            default:        return await this.explainWithOpenAI(prompt);
        }
    }

    buildPrompt(question, selectedAnswer) {
        return `Hãy giải thích câu hỏi tiếng Anh sau và cho biết đáp án đúng là gì:

Câu hỏi: ${question.text}
Các lựa chọn: ${question.options.map(o => `${o.letter}. ${o.text}`).join(', ')}
Đáp án đã chọn: ${selectedAnswer ? `${selectedAnswer.letter}. ${selectedAnswer.text}` : 'Chưa chọn'}

Hãy giải thích:
1. Đáp án đúng là gì?
2. Tại sao đáp án đó đúng?
3. Giải thích ngắn gọn bằng tiếng Việt để học sinh tiểu học có thể hiểu
`;
    }

    // ─── OpenAI ───────────────────────────────────────────────────────────────

    async explainWithOpenAI(prompt) {
        if (!this.openai) {
            return { error: 'OpenAI not configured', provider: 'openai' };
        }

        const model = 'gpt-4o-mini';
        const start = Date.now();
        this._logRequest('openai', model, prompt);

        try {
            const response = await this.openai.chat.completions.create({
                model,
                messages: [
                    { role: 'system', content: 'Bạn là giáo viên tiếng Anh cho học sinh tiểu học. Giải thích ngắn gọn, dễ hiểu.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 500,
                temperature: 0.7
            });

            const content = response.choices[0].message.content;
            this._logResponse('openai', model, start, content);
            return { explanation: content, provider: 'openai', model };
        } catch (error) {
            this._logError('openai', model, start, error);
            return { error: error.message, provider: 'openai' };
        }
    }

    // ─── Kimi K2 (Moonshot AI) ────────────────────────────────────────────────

    async explainWithKimi(prompt) {
        if (!this.kimi) {
            console.warn('⚠️  Kimi not configured — set KIMI_API_KEY env variable');
            return { error: 'Kimi API key not configured. Set KIMI_API_KEY in Railway environment.', provider: 'kimi' };
        }

        const model = 'kimi-k2-0711-preview';
        const start = Date.now();
        this._logRequest('kimi', model, prompt);

        try {
            const response = await this.kimi.chat.completions.create({
                model,
                messages: [
                    { role: 'system', content: 'Bạn là giáo viên tiếng Anh cho học sinh tiểu học. Giải thích ngắn gọn, dễ hiểu bằng tiếng Việt.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 500,
                temperature: 0.7
            });

            const content = response.choices[0].message.content;
            this._logResponse('kimi', model, start, content);
            return { explanation: content, provider: 'kimi', model };
        } catch (error) {
            this._logError('kimi', model, start, error);
            return { error: error.message, provider: 'kimi' };
        }
    }

    // ─── Gemini ───────────────────────────────────────────────────────────────

    async explainWithGemini(prompt) {
        if (!this.geminiKey) {
            return { error: 'Gemini not configured', provider: 'gemini' };
        }

        const model = 'gemini-1.5-flash';
        const start = Date.now();
        this._logRequest('gemini', model, prompt);

        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.geminiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.7, maxOutputTokens: 500 }
                    })
                }
            );

            const data = await response.json();

            if (data.candidates?.[0]) {
                const content = data.candidates[0].content.parts[0].text;
                this._logResponse('gemini', model, start, content);
                return { explanation: content, provider: 'gemini', model };
            }

            this._logError('gemini', model, start, new Error('No response candidates'));
            return { error: 'No response from Gemini', provider: 'gemini' };
        } catch (error) {
            this._logError('gemini', model, start, error);
            return { error: error.message, provider: 'gemini' };
        }
    }

    // ─── Batch explain ────────────────────────────────────────────────────────

    async explainBatch(questions, selectedAnswers, provider = 'openai') {
        const results = [];
        for (let i = 0; i < questions.length; i++) {
            const result = await this.explainAnswer(questions[i], selectedAnswers[i], provider);
            results.push({ questionId: questions[i].id, ...result });
            if (i < questions.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        return results;
    }
}

export default new AIService();
