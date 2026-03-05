// AI Service - Multi-provider AI for explanations + OCR
// Providers: openai | kimi | gemini | alibaba
import OpenAI from 'openai';
import { getApiKey, getSetting } from './database.js';

// ─── Predefined prompt templates ──────────────────────────────────────────────

const PROMPT_TEMPLATES = {
    ioe_english: {
        id: 'ioe_english',
        name: 'IOE English (Đề thi tiếng Anh)',
        description: 'MCQ A/B/C/D, listening, fill-in-blank, look & write',
        text: `Bạn là hệ thống trích xuất đề thi tiếng Anh (IOE / Olympic English) cho học sinh Việt Nam.

NHIỆM VỤ: Đọc nội dung đề thi tiếng Anh và trích xuất TỪNG CÂU HỎI theo cấu trúc JSON.

CÁC DẠNG CÂU HỎI CẦN NHẬN DIỆN:
1. MCQ (chọn A/B/C/D): "Which word has the sound like...", "Choose the correct answer", "The bananas ___ on the table. A. be  B. is  C. are  D. am"
2. Listening (nghe): Câu có "Nghe:", "Listen", "Nhấn giữ Ctrl và bấm chuột để nghe" → ghi type = "listening"
3. Fill-in-blank (điền từ): "Look and write: ____", "Fill in the blank"
4. Pick the extra word: "Pick the extra word in the sentence" → ghi các từ phân cách bằng "/"
5. Image-based: Câu có hình ảnh (Ảnh:) → ghi "[Hình minh họa]" và mô tả nếu thấy

CÁCH TRÍCH XUẤT:
- "cau": số thứ tự câu hỏi
- "noi_dung": Toàn bộ nội dung câu hỏi (VD: "Which word has the sound like the letter R in RAINBOW?")
- "dap_an": Đáp án đúng nếu có (VD: "B", "road", "are")
- "giai_thich": Toàn bộ nội dung câu hỏi + options nếu có. VD: "Which word has the sound like R in RAINBOW? A. cake B. road C. vase D. lake"
- "options": Mảng các lựa chọn nếu là MCQ [{letter, text}]
- "type": "mcq" | "listening" | "fill_blank" | "other"

BỎ QUA: Quảng cáo, watermark, header/footer, QR code, số điện thoại, zalo.
GIỮ NGUYÊN: Tiếng Anh chính xác, dấu tiếng Việt, ký hiệu đặc biệt.
BẮT BUỘC: Chỉ trả về JSON array, KHÔNG markdown, KHÔNG text ngoài JSON.

FORMAT:
[
  {
    "de_so": 1,
    "questions": [
      {
        "cau": 1,
        "noi_dung": "Which word has the sound like the letter R in RAINBOW?",
        "dap_an": "B",
        "giai_thich": "Which word has the sound like the letter R in RAINBOW? A. cake  B. road  C. vase  D. lake",
        "options": [{"letter":"A","text":"cake"},{"letter":"B","text":"road"},{"letter":"C","text":"vase"},{"letter":"D","text":"lake"}],
        "type": "mcq"
      },
      {
        "cau": 4,
        "noi_dung": "Nghe: Nhấn giữ Ctrl và bấm chuột để nghe",
        "dap_an": "",
        "giai_thich": "Listening question - R/EN/F/TE/OU",
        "options": [],
        "type": "listening"
      },
      {
        "cau": 9,
        "noi_dung": "Look and write: _____",
        "dap_an": "",
        "giai_thich": "[Hình minh họa] Look and write: _____",
        "options": [],
        "type": "fill_blank"
      }
    ]
  }
]`,
        vision: `Bạn là hệ thống OCR trích xuất đề thi tiếng Anh (IOE / Olympic English) từ ảnh.

NHIỆM VỤ: Đọc ảnh đề thi và trích xuất TỪNG CÂU HỎI theo cấu trúc JSON.

CÁC DẠNG CÂU HỎI:
1. MCQ (A/B/C/D): Câu hỏi + 4 lựa chọn
2. Listening: Có biểu tượng tai nghe, "Nghe:", "Listen" → type = "listening"
3. Fill-in-blank: "Look and write", điền vào ___
4. Pick the extra word: Từ phân cách bằng "/"
5. Image-based: Có hình ảnh kèm câu hỏi → mô tả hình

CÁCH TRÍCH XUẤT:
- "cau": số thứ tự
- "noi_dung": Nội dung câu hỏi đầy đủ
- "dap_an": Đáp án đúng nếu thấy (letter hoặc text)
- "giai_thich": Toàn bộ nội dung câu + options
- "options": [{letter, text}] cho MCQ
- "type": "mcq" | "listening" | "fill_blank" | "other"

BỎ QUA: Watermark, QR, quảng cáo, số điện thoại.
GIỮ NGUYÊN: Tiếng Anh chính xác, hình ảnh mô tả.
BẮT BUỘC: Chỉ trả về JSON array, KHÔNG markdown.

FORMAT: [{"de_so":1,"questions":[{"cau":1,"noi_dung":"...","dap_an":"B","giai_thich":"...","options":[{"letter":"A","text":"..."}],"type":"mcq"}]}]`
    },

    vioedu_answer: {
        id: 'vioedu_answer',
        name: 'VIOEDU/Violympic (Đáp án + giải thích)',
        description: 'File đáp án Toán/Tiếng Việt có giải thích chi tiết',
        text: `Bạn là hệ thống trích xuất đề thi/đáp án giáo dục Việt Nam.

NHIỆM VỤ: Đọc nội dung text và trích xuất TỪNG CÂU HỎI theo cấu trúc JSON.

CÁCH NHẬN DIỆN:
- Mỗi đề bắt đầu bằng "ĐỀ SỐ X"
- Mỗi câu bắt đầu bằng "Câu X" hoặc "Câu X .Đáp án"
- Sau "Đáp án" là phần giải thích, có thể nhiều dòng cho đến câu tiếp theo
- Đáp án ngắn gọn (số, từ, Đúng/Sai, A/B/C/D) thường nằm ở cuối phần giải thích

CÁCH TRÍCH XUẤT:
1. "dap_an": Chỉ ghi đáp án cuối cùng, ngắn gọn nhất (VD: "8", "Đúng", "Sai", "Quả cam", "A", "5")
2. "giai_thich": Ghi TOÀN BỘ nội dung giải thích/hướng dẫn của câu đó (bao gồm phép tính, lập luận, kết luận)

BỎ QUA: Quảng cáo, watermark, header/footer, số điện thoại, thông tin liên hệ, số trang.
GIỮ NGUYÊN: Phép tính (6−1=5), dấu tiếng Việt, ký hiệu toán, tên riêng, tiếng Anh.
BẮT BUỘC: Chỉ trả về JSON array, KHÔNG markdown, KHÔNG text ngoài JSON.

FORMAT:
[
  {
    "de_so": 1,
    "questions": [
      {
        "cau": 1,
        "dap_an": "Đúng",
        "giai_thich": "Từ 6 đếm lùi 1 bước. Vậy 6−1=5. Do đó, bạn Hùng minh họa đúng."
      },
      {
        "cau": 5,
        "dap_an": "8",
        "giai_thich": "Từ 9 đếm lùi 1 bước. Vậy 9−1=8. Số cần điền vào dấu hỏi chấm là 8."
      }
    ]
  }
]`,
        vision: null // uses default vision prompt
    },

    generic: {
        id: 'generic',
        name: 'Tự động (Generic)',
        description: 'Prompt mặc định, phù hợp nhiều loại đề thi',
        text: null, // will use the built-in default
        vision: null
    }
};

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
            alibaba: { envKey: 'ALIBABA_API_KEY',   baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen3.5-122b-a10b', visionModel: 'qwen2.5-vl-72b-instruct' },
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
            openai:  { text: 'gpt-4o-mini',          vision: 'gpt-4o',                   reasoning: 'gpt-4o'              },
            kimi:    { text: 'kimi-k2-0711-preview',  vision: null,                        reasoning: 'kimi-k2-0711-preview'},
            alibaba: { text: 'qwen3.5-122b-a10b',    vision: 'qwen2.5-vl-72b-instruct',  reasoning: 'qwq-plus'           },
            gemini:  { text: 'gemini-1.5-flash',      vision: 'gemini-1.5-flash',          reasoning: 'gemini-1.5-flash'   },
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
        // Default: prefer alibaba, then openai
        for (const p of ['alibaba', 'openai', 'kimi', 'gemini']) {
            const client = await this._client(p);
            if (client) return p;
        }
        return 'alibaba';
    }

    async resolveAnalyzeProvider() {
        try {
            const pref = await getApiKey('analyze_provider');
            if (pref && pref !== 'auto') return pref;
        } catch { /* ignore */ }
        // Default: prefer alibaba (qwq-plus reasoning model), then openai
        for (const p of ['alibaba', 'openai', 'gemini', 'kimi']) {
            const client = await this._client(p);
            if (client) return p;
        }
        return 'alibaba';
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

        const model = this._modelConfig(p).reasoning || this._modelConfig(p).text;
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
- Giữ nguyên "de_so", "cau", "dap_an", "giai_thich", "noi_dung" (QUAN TRỌNG: giữ nguyên noi_dung tiếng Anh gốc, KHÔNG dịch sang tiếng Việt)

FORMAT OUTPUT:
[
  {
    "de_so": 1,
    "cau": 1,
    "noi_dung": "Which word has the sound like the letter R in RAINBOW?",
    "type": "mcq",
    "interactive": true,
    "dap_an": "B",
    "correct": "B",
    "options": [{"letter": "A", "text": "cake"}, {"letter": "B", "text": "road"}, {"letter": "C", "text": "vase"}, {"letter": "D", "text": "lake"}],
    "giai_thich": "Which word has the sound like R in RAINBOW? A. cake B. road C. vase D. lake"
  },
  {
    "de_so": 1,
    "cau": 2,
    "noi_dung": "5 + 3 = ?",
    "type": "fill_blank",
    "interactive": false,
    "dap_an": "8",
    "correct": "8",
    "options": [],
    "giai_thich": "5 + 3 = 8"
  }
]`;

        try {
            const response = await client.chat.completions.create({
                model,
                messages: [
                    { role: 'system', content: 'Bạn là chuyên gia phân tích đề thi. Chỉ trả về JSON array.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 16000,
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

    /**
     * Resolve the system prompt for OCR text parsing.
     * Priority: customPrompt param > template > DB setting > vioedu_answer default
     */
    async _resolveTextPrompt(templateId = null, customPrompt = null) {
        if (customPrompt) return customPrompt;
        const tpl = PROMPT_TEMPLATES[templateId];
        if (tpl?.text) return tpl.text;
        // Try DB custom prompt
        try {
            const dbPrompt = await getSetting('ocr_text_prompt');
            if (dbPrompt) return dbPrompt;
        } catch { /* ignore */ }
        // Fallback to vioedu_answer (the most common format)
        return PROMPT_TEMPLATES.vioedu_answer.text;
    }

    async _resolveVisionPrompt(templateId = null) {
        const tpl = PROMPT_TEMPLATES[templateId];
        if (tpl?.vision) return tpl.vision;
        // Default vision prompt (generic)
        return PROMPT_TEMPLATES.ioe_english.vision;
    }

    async parseQuestionsFromText(text, provider = null, templateId = null, customPrompt = null) {
        const p = provider || await this.resolveOcrProvider();
        const client = await this._client(p);
        if (!client) { console.warn(`⚠️ No API key for provider: ${p}`); return []; }

        const model = this._modelConfig(p).text;
        const start = Date.now();
        this._log('📡', p, model, null, `template=${templateId || 'default'}`);

        const systemPrompt = await this._resolveTextPrompt(templateId, customPrompt);

        try {
            const response = await client.chat.completions.create({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Trích xuất tất cả câu hỏi và đáp án từ nội dung sau:\n\n${text}` }
                ],
                max_tokens: 16000,
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

    async parseQuestionsFromImages(base64Images, provider = null, templateId = null) {
        const p = provider || await this.resolveOcrProvider();
        const { vision } = this._modelConfig(p);

        if (!vision) {
            console.warn(`⚠️ Provider ${p} does not support vision — falling back to openai`);
            return this.parseQuestionsFromImages(base64Images, 'openai', templateId);
        }

        const client = await this._client(p);
        if (!client) { console.warn(`⚠️ No API key for provider: ${p}`); return []; }

        const start = Date.now();
        this._log('📡👁️', p, vision, null, `template=${templateId || 'default'}`);

        const systemPrompt = await this._resolveVisionPrompt(templateId);

        try {
            const imageContents = base64Images.map(b64 => ({
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'high' }
            }));

            const response = await client.chat.completions.create({
                model: vision,
                messages: [
                    { role: 'system', content: systemPrompt },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: 'Trích xuất tất cả câu hỏi và đáp án từ các trang đề thi này. Trả về JSON array:' },
                            ...imageContents
                        ]
                    }
                ],
                max_tokens: 16000,
                temperature: 0
            });

            const content = response.choices[0].message.content.trim();
            this._log('✅👁️', p, vision, Date.now() - start, content);
            return this._extractJsonArray(content);
        } catch (err) {
            this._log('❌👁️', p, vision, Date.now() - start, err.message);
            return [];
        }
    }

    /**
     * Robustly extract JSON array from AI response.
     * Handles: raw JSON, markdown-wrapped JSON, text with embedded JSON, truncated JSON.
     */
    _extractJsonArray(content) {
        let cleaned = content
            .replace(/<think>[\s\S]*?<\/think>/g, '')   // strip QwQ reasoning tags
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
        const hasOptions = question.options && question.options.length > 0;
        const optionsText = hasOptions
            ? `Các lựa chọn: ${question.options.map(o => `${o.letter}. ${o.text}`).join(', ')}`
            : '(Câu hỏi tự luận / điền đáp án)';
        const answerText = selectedAnswer
            ? (selectedAnswer.letter !== '-' ? `${selectedAnswer.letter}. ${selectedAnswer.text}` : selectedAnswer.text)
            : 'Chưa trả lời';
        const correctText = question.correctAnswer ? `Đáp án đúng: ${question.correctAnswer}` : '';

        return `Hãy giải thích câu hỏi sau và cho biết đáp án đúng:

Câu hỏi: ${question.text}
${optionsText}
Đáp án đã chọn: ${answerText}
${correctText}

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
            let content = res.choices[0].message.content;
            // Strip QwQ <think> reasoning tags if present
            content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
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

const aiService = new AIService();
export default aiService;
export { PROMPT_TEMPLATES };
