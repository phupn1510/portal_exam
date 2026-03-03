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
        // Read from DB first (set via admin page)
        try {
            const pref = await getApiKey('ocr_provider');
            if (pref && pref !== 'auto') {
                console.log(`[OCR] provider from DB: ${pref}`);
                return pref;
            }
        } catch { /* ignore */ }
        // Auto-detect: first provider with a valid key
        for (const p of ['openai', 'alibaba', 'kimi']) {
            const client = await this._client(p);
            if (client) { console.log(`[OCR] auto-detected provider: ${p}`); return p; }
        }
        return 'openai';
    }

    async resolveAnswerProvider() {
        try {
            const pref = await getApiKey('answer_provider');
            if (pref && pref !== 'auto') return pref;
        } catch { /* ignore */ }
        for (const p of ['openai', 'alibaba', 'kimi', 'gemini']) {
            const client = await this._client(p);
            if (client) return p;
        }
        return 'openai';
    }

    async resolveAnalyzeProvider() {
        try {
            const pref = await getApiKey('analyze_provider');
            if (pref && pref !== 'auto') return pref;
        } catch { /* ignore */ }
        // Default: prefer openai (smarter for analysis), then alibaba
        for (const p of ['openai', 'alibaba', 'gemini', 'kimi']) {
            const client = await this._client(p);
            if (client) return p;
        }
        return 'openai';
    }

    /**
     * Step 2 of the pipeline: takes raw OCR output and uses AI to:
     * - Classify question type (mcq / fill_blank / true_false)
     * - Extract MCQ options (A/B/C/D) when present
     * - Mark which questions are interactive (can student select an answer?)
     * - Verify and clean up dap_an/giai_thich
     */
    async analyzeExtractedQuestions(rawOcrData, provider = null) {
        const p = provider || await this.resolveAnalyzeProvider();
        const client = await this._client(p);
        if (!client) { console.warn(`⚠️ No API key for analyze provider: ${p}`); return rawOcrData; }

        const model = this._modelConfig(p).text;
        const start = Date.now();
        this._log('🧠📡', p, model, null, 'Analyzing question types...');

        const prompt = `Bạn là chuyên gia phân tích đề thi Việt Nam. Đây là dữ liệu OCR thô từ đề thi.

NHIỆM VỤ: Phân tích và phân loại từng câu hỏi.

INPUT (JSON từ OCR):
${JSON.stringify(rawOcrData, null, 2)}

OUTPUT: Trả về JSON array đã được phân tích. KHÔNG markdown, KHÔNG text ngoài JSON.

Với mỗi câu, xác định:
- "type": "mcq" (chọn A/B/C/D), "fill_blank" (điền vào chỗ trống), "true_false" (Đúng/Sai), "other"
- "interactive": true nếu học sinh có thể chọn đáp án (mcq, true_false), false nếu điền tay (fill_blank)
- "options": [{letter, text}] nếu là MCQ (trích từ giai_thich hoặc suy luận)
- "correct": đáp án đúng (string)
- Giữ nguyên "de_so", "cau", "dap_an", "giai_thich"

FORMAT OUTPUT:
[
  {
    "de_so": 1,
    "cau": 1,
    "type": "true_false",
    "interactive": true,
    "dap_an": "Đúng",
    "correct": "Đúng",
    "options": [{"letter": "A", "text": "Đúng"}, {"letter": "B", "text": "Sai"}],
    "giai_thich": "..."
  },
  {
    "de_so": 1,
    "cau": 2,
    "type": "fill_blank",
    "interactive": false,
    "dap_an": "5",
    "correct": "5",
    "options": [],
    "giai_thich": "..."
  }
]`;

        try {
            const response = await client.chat.completions.create({
                model,
                messages: [
                    { role: 'system', content: 'Bạn là chuyên gia phân tích đề thi. Chỉ trả về JSON array.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 6000,
                temperature: 0
            });
            const content = response.choices[0].message.content.trim();
            this._log('🧠✅', p, model, Date.now() - start, content);
            return this._extractJsonArray(content);
        } catch (err) {
            this._log('🧠❌', p, model, Date.now() - start, err.message);
            return rawOcrData; // return unanalyzed data as fallback
        }
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
                        content: `Bạn là một hệ thống OCR chuyên xử lý tài liệu giáo dục tiếng Việt. Hãy đọc và trích xuất TOÀN BỘ nội dung từ file PDF đề thi/đáp án sau đây.

YÊU CẦU:
1. Trích xuất theo từng ĐỀ SỐ (Đề số 1, Đề số 2, ...) riêng biệt.
2. Với mỗi đề, liệt kê từng câu hỏi theo format:
   
   **ĐỀ SỐ [X]**
   Câu [số] . Đáp án: [nội dung đáp án]
   [Phần giải thích/hướng dẫn nếu có]

3. Giữ nguyên:
   - Tất cả phép tính toán học (ví dụ: 6−1=5, 9−3=6)
   - Dấu tiếng Việt (ă, â, ê, ô, ơ, ư, đ và các dấu thanh)
   - Các ký hiệu toán học (<, >, =, +, −)
   - Số La Mã, số thường
   - Tên riêng (bạn Hùng, bạn Mai, bạn Hà...)

4. BỎ QUA:
   - Header/footer quảng cáo (số điện thoại, thông tin liên hệ, 
                        content: `Bạn là hệ thống OCR chuyên xử lý đề thi giáo dục tiếng Việt.

NHIỆM VỤ: Đọc nội dung text đề thi/đáp án và trả về JSON array.

BỎ QUA: Quảng cáo, watermark, header/footer (số điện thoại, "Team Cô Hoa", "Nam Thắng", zalo, khóa học...), số trang.

GIỮ NGUYÊN: Phép tính (6−1=5), dấu tiếng Việt, ký hiệu toán (<, >, =), tên riêng, tiếng Anh.

BẮT BUỘC: Chỉ trả về JSON array, KHÔNG markdown, KHÔNG giải thích, KHÔNG text ngoài JSON.

FORMAT:
[
  {
    "de_so": 1,
    "questions": [
      {
        "cau": 1,
        "dap_an": "Đúng",
        "giai_thich": "Từ 6 đếm lùi 1 bước. 6−1=5. Bạn Hùng minh họa đúng."
      }
    ]
  },
  {
    "de_so": 2,
    "questions": [...]
  }
]

Quy tắc cho "dap_an": Chỉ ghi đáp án ngắn gọn (số, từ, Đúng/Sai, chữ cái A/B/C/D...).
Quy tắc cho "giai_thich": Ghi toàn bộ phần giải thích/hướng dẫn. Nếu không có, để "".`
                    },
                    { role: 'user', content: `Trích xuất câu hỏi và đáp án từ:\n\n${text}` }
                ],
                max_tokens: 4000,
                temperature: 0
            });

            const content = response.choices[0].message.content.trim();
            this._log('✅', p, model, Date.now() - start, content);
            return this._extractJsonArray(content);
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
                    content: `Bạn là hệ thống OCR chuyên xử lý đề thi giáo dục tiếng Việt.

NHIỆM VỤ: Đọc ảnh đề thi/đáp án và trả về JSON array.

BỎ QUA: Quảng cáo, watermark, header/footer (số điện thoại, "Team Cô Hoa", "Nam Thắng", zalo, khóa học...), số trang.

GIỮ NGUYÊN: Phép tính (6−1=5), dấu tiếng Việt, ký hiệu toán (<, >, =), tên riêng, tiếng Anh.
Nếu có hình không đọc được, ghi "[Hình minh họa]".

BẮT BUỘC: Chỉ trả về JSON array, KHÔNG markdown, KHÔNG giải thích, KHÔNG text ngoài JSON.

FORMAT:
[
  {
    "de_so": 1,
    "questions": [
      {
        "cau": 1,
        "dap_an": "Đúng",
        "giai_thich": "Từ 6 đếm lùi 1 bước. 6−1=5. Bạn Hùng minh họa đúng."
      },
      {
        "cau": 2,
        "dap_an": "Sai",
        "giai_thich": "Từ 6 đếm lùi 1 bước. 6−1=5. Bạn Mai minh họa sai."
      }
    ]
  },
  {
    "de_so": 2,
    "questions": [...]
  }
]

Quy tắc cho "dap_an": Chỉ ghi đáp án ngắn gọn cuối cùng (số, từ, Đúng/Sai, tên bạn...).
Quy tắc cho "giai_thich": Ghi toàn bộ phần giải thích/hướng dẫn.
Nếu không có giải thích, để "giai_thich": "".`
                },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Trích xuất tất cả câu hỏi và đáp án từ các trang đề thi này. Trả về JSON array:' },
                        ...imageContents
                    ]
                }
            ],
            max_tokens: 4000,
            temperature: 0
        });

        const content = response.choices[0].message.content.trim();
        this._log('✅👁️', p, vision, Date.now() - start, content);

        // Try to extract JSON array from response
        const parsed = this._extractJsonArray(content);
        return parsed;
    } catch (err) {
        this._log('❌👁️', p, vision, Date.now() - start, err.message);
        return [];
    }

    /**
     * Robustly extract JSON array from AI response.
     * Handles: raw JSON, markdown-wrapped JSON, text with embedded JSON, truncated JSON.
     */
    _extractJsonArray(content) {
        let cleaned = content
            .replace(/^```(?:json)?\s*\n?/i, '')
            .replace(/\n?```\s*$/i, '')
            .trim();

        // 1. Direct parse
        try {
            const parsed = JSON.parse(cleaned);
            return Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) { /* continue */ }

        // 2. Find JSON array in text
        const match = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (match) {
            try { return JSON.parse(match[0]); } catch (e) { /* continue */ }
        }

        // 3. Try to fix truncated JSON
        if (!cleaned.endsWith(']')) {
            const lastBrace = cleaned.lastIndexOf('}');
            if (lastBrace > 0) {
                let fixed = cleaned.substring(0, lastBrace + 1);
                const open = (fixed.match(/\[/g) || []).length;
                const close = (fixed.match(/\]/g) || []).length;
                for (let i = 0; i < open - close; i++) fixed += ']';
                try { return JSON.parse(fixed); } catch (e) { /* continue */ }
            }
        }

        console.warn('⚠️ Could not parse JSON from OCR response');
        return [];
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
