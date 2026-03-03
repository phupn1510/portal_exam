// AI Service - Multi-provider AI for explanations + OCR
// Providers: openai | kimi | gemini | alibaba
import OpenAI from 'openai';
import { getApiKey } from './database.js';

class AIService {
    constructor() {
        this._clients = {}; // lazy-init per provider
    }

    // ─── Logging ──────────────────────────────────────────────────────────────

    _log(tag, provider, model, ms, preview = '') {
        const time = ms ? ` time=${ms}ms` : '';
        console.log(`${tag} [AI:${provider}] model=${model}${time}${preview ? ` | "${preview.slice(0, 80).replace(/\n/g, ' ')}"` : ''}`);
    }

    // ─── Client factory (lazy, reads API keys from DB then env) ──────────────

    async _client(provider) {
        const cfg = {
            openai:  { envKey: 'OPENAI_API_KEY',   baseURL: undefined,                               defaultModel: 'gpt-4o-mini',         visionModel: 'gpt-4o'             },
            kimi:    { envKey: 'KIMI_API_KEY',      baseURL: 'https://api.moonshot.cn/v1',            defaultModel: 'kimi-k2-0711-preview', visionModel: null                  },
            alibaba: { envKey: 'ALIBABA_API_KEY',   baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-max', visionModel: 'qwen-vl-max' },
            gemini:  { envKey: 'GEMINI_API_KEY',    baseURL: undefined,                               defaultModel: 'gemini-1.5-flash',     visionModel: 'gemini-1.5-flash'   },
        };

        if (!cfg[provider]) throw new Error(`Unknown provider: ${provider}`);
        const { envKey, baseURL } = cfg[provider];

        // Read key from DB first, then fall back to env
        let apiKey = null;
        try { apiKey = await getApiKey(provider); } catch { apiKey = process.env[envKey] || null; }
        if (!apiKey) return null;

        if (!this._clients[provider]) {
            this._clients[provider] = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
        }
        return this._clients[provider];
    }

    _modelConfig(provider) {
        const map = {
            openai:  { text: 'gpt-4o-mini',          vision: 'gpt-4o'          },
            kimi:    { text: 'kimi-k2-0711-preview',  vision: null              },
            alibaba: { text: 'qwen-max',              vision: 'qwen-vl-max'     },
            gemini:  { text: 'gemini-1.5-flash',      vision: 'gemini-1.5-flash'},
        };
        return map[provider] || map.openai;
    }

    // ─── Resolve the active OCR provider ─────────────────────────────────────

    async resolveOcrProvider() {
        // Explicit override from DB setting
        try {
            const { getSetting } = await import('./database.js');
            const pref = await getSetting?.('ocr_provider');
            if (pref) return pref;
        } catch { /* ignore */ }
        // Auto-detect: first available key
        for (const p of ['openai', 'alibaba', 'kimi']) {
            const client = await this._client(p);
            if (client) return p;
        }
        return 'openai'; // fallback (will fail gracefully if no key)
    }

    // ─── OCR: parse questions from text ───────────────────────────────────────

    async parseQuestionsFromText(text, provider = null) {
        const p = provider || await this.resolveOcrProvider();
        const client = await this._client(p);
        if (!client) { console.warn(`⚠️ No API key for provider: ${p}`); return []; }

        const model = this._modelConfig(p).text;
        const start = Date.now();
        this._log('📡', p, model, null);

        try {
            const response = await client.chat.completions.create({
                model,
                messages: [
                    {
                        role: 'system',
                        content: `You are an expert at parsing Vietnamese IOE (International Olympiad of English) exam papers.
Extract ALL multiple-choice questions from the text.
Return ONLY a valid JSON array:
[{ "number": <int>, "text": "<question>", "type": "listening"|"reading", "options": [{"letter":"A","text":"..."},...] }]
Set type to "listening" if the question involves audio (listen, nghe, sound, pronunciation, etc.).
Otherwise "reading". If no questions found, return [].`
                    },
                    { role: 'user', content: `Extract questions from:\n\n${text}` }
                ],
                max_tokens: 4000,
                temperature: 0
            });

            const content = response.choices[0].message.content.trim();
            this._log('✅', p, model, Date.now() - start, content);
            const match = content.match(/\[[\s\S]*\]/);
            return match ? JSON.parse(match[0]) : [];
        } catch (err) {
            this._log('❌', p, model, Date.now() - start, err.message);
            return [];
        }
    }

    // ─── OCR: parse questions from images ─────────────────────────────────────

    async parseQuestionsFromImages(base64Images, provider = null) {
        const p = provider || await this.resolveOcrProvider();
        const { vision } = this._modelConfig(p);

        if (!vision) {
            console.warn(`⚠️ Provider ${p} does not support vision — falling back to openai`);
            return this.parseQuestionsFromImages(base64Images, 'openai');
        }

        const client = await this._client(p);
        if (!client) { console.warn(`⚠️ No API key for provider: ${p}`); return []; }

        const start = Date.now();
        this._log('📡👁️', p, vision, null);

        try {
            const imageContents = base64Images.map(b64 => ({
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'high' }
            }));

            const response = await client.chat.completions.create({
                model: vision,
                messages: [
                    {
                        role: 'system',
                        content: `You are an expert at parsing Vietnamese IOE exam papers from images.
Extract ALL multiple-choice questions visible in the images.
Return ONLY a valid JSON array:
[{ "number": <int>, "text": "<question>", "type": "listening"|"reading", "options": [{"letter":"A","text":"..."},...] }]
Set type to "listening" if the question is in a listening section (look for 🎧, "LISTENING", "Nghe", speaker symbols).
Otherwise "reading". If no questions, return [].`
                    },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: 'Extract all questions and answer choices from these exam pages:' },
                            ...imageContents
                        ]
                    }
                ],
                max_tokens: 4000,
                temperature: 0
            });

            const content = response.choices[0].message.content.trim();
            this._log('✅👁️', p, vision, Date.now() - start, content);
            const match = content.match(/\[[\s\S]*\]/);
            return match ? JSON.parse(match[0]) : [];
        } catch (err) {
            this._log('❌👁️', p, vision, Date.now() - start, err.message);
            return [];
        }
    }

    // ─── Explain answer ───────────────────────────────────────────────────────

    async explainAnswer(question, selectedAnswer, provider = 'openai') {
        const prompt = this._buildExplainPrompt(question, selectedAnswer);
        if (provider === 'gemini') return this._explainWithGemini(prompt);
        return this._explainWithOpenAICompat(prompt, provider);
    }

    _buildExplainPrompt(question, selectedAnswer) {
        return `Hãy giải thích câu hỏi tiếng Anh sau và cho biết đáp án đúng:

Câu hỏi: ${question.text}
Các lựa chọn: ${question.options.map(o => `${o.letter}. ${o.text}`).join(', ')}
Đáp án đã chọn: ${selectedAnswer ? `${selectedAnswer.letter}. ${selectedAnswer.text}` : 'Chưa chọn'}

Giải thích ngắn gọn bằng tiếng Việt (học sinh tiểu học có thể hiểu):
1. Đáp án đúng là gì?
2. Tại sao?`;
    }

    async _explainWithOpenAICompat(prompt, provider) {
        const client = await this._client(provider);
        if (!client) return { error: `${provider} not configured`, provider };

        const model = this._modelConfig(provider).text;
        const start = Date.now();
        this._log('📡', provider, model, null, prompt);

        try {
            const res = await client.chat.completions.create({
                model,
                messages: [
                    { role: 'system', content: 'Bạn là giáo viên tiếng Anh cho học sinh tiểu học. Giải thích ngắn gọn, dễ hiểu.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 500, temperature: 0.7
            });
            const content = res.choices[0].message.content;
            this._log('✅', provider, model, Date.now() - start, content);
            return { explanation: content, provider, model };
        } catch (err) {
            this._log('❌', provider, model, Date.now() - start, err.message);
            return { error: err.message, provider };
        }
    }

    async _explainWithGemini(prompt) {
        let apiKey = null;
        try { apiKey = await getApiKey('gemini'); } catch { apiKey = process.env.GEMINI_API_KEY; }
        if (!apiKey) return { error: 'Gemini not configured', provider: 'gemini' };

        const model = 'gemini-1.5-flash';
        const start = Date.now();
        this._log('📡', 'gemini', model, null, prompt);

        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 500 } }) }
            );
            const data = await res.json();
            const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!content) throw new Error('No response from Gemini');
            this._log('✅', 'gemini', model, Date.now() - start, content);
            return { explanation: content, provider: 'gemini', model };
        } catch (err) {
            this._log('❌', 'gemini', model, Date.now() - start, err.message);
            return { error: err.message, provider: 'gemini' };
        }
    }
}

export default new AIService();
