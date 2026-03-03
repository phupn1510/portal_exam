import express from 'express';
import { isAuthenticated } from '../services/authService.js';
import { getAdminEmails, addAdminEmail, removeAdminEmail, getApiKey, setApiKey, getSetting, setSetting } from '../services/database.js';

const router = express.Router();
const OWNER_EMAIL = 'phupn1510@gmail.com';

// Only the owner can access admin settings
function isOwner(req, res, next) {
    if (!req.isAuthenticated() || req.user.email !== OWNER_EMAIL) {
        return res.status(403).json({ error: 'Owner access required' });
    }
    next();
}

// GET /api/admin/settings — full settings summary
router.get('/settings', isOwner, async (req, res) => {
    try {
        const emails = await getAdminEmails();
        const providers = ['openai', 'kimi', 'alibaba', 'gemini'];
        const keys = {};
        for (const p of providers) {
            const key = await getApiKey(p);
            keys[p] = key ? `${key.slice(0, 8)}${'*'.repeat(12)}` : null;
        }
        const ocrProvider = await getApiKey('ocr_provider') || process.env.OCR_PROVIDER || 'auto';
        const answerProvider = await getApiKey('answer_provider') || process.env.ANSWER_PROVIDER || 'auto';
        const analyzeProvider = await getApiKey('analyze_provider') || 'auto';
        let ocrTextPrompt = null;
        try { ocrTextPrompt = await getSetting('ocr_text_prompt'); } catch { /* ignore */ }
        res.json({ adminEmails: emails, apiKeys: keys, ownerEmail: OWNER_EMAIL, ocrProvider, answerProvider, analyzeProvider, ocrTextPrompt });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/admin/emails — add admin email
router.post('/emails', isOwner, async (req, res) => {
    const { email } = req.body;
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Invalid email' });
    try {
        await addAdminEmail(email.trim().toLowerCase());
        const emails = await getAdminEmails();
        res.json({ success: true, adminEmails: emails });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/admin/emails/:email — remove admin email
router.delete('/emails/:email', isOwner, async (req, res) => {
    try {
        await removeAdminEmail(decodeURIComponent(req.params.email));
        const emails = await getAdminEmails();
        res.json({ success: true, adminEmails: emails });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/admin/keys — set an API key
router.post('/keys', isOwner, async (req, res) => {
    const { provider, key } = req.body;
    const allowed = ['openai', 'kimi', 'gemini', 'alibaba'];
    if (!allowed.includes(provider)) return res.status(400).json({ error: 'Invalid provider' });
    if (!key || key.length < 10) return res.status(400).json({ error: 'Key too short' });
    try {
        await setApiKey(provider, key.trim());
        res.json({ success: true, provider });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/admin/ocr-provider
router.get('/ocr-provider', isOwner, async (req, res) => {
    const p = await getApiKey('ocr_provider').catch(() => null);
    res.json({ ocrProvider: p || process.env.OCR_PROVIDER || 'auto' });
});

// POST /api/admin/ocr-provider
router.post('/ocr-provider', isOwner, async (req, res) => {
    const { provider } = req.body;
    const allowed = ['auto', 'openai', 'kimi', 'alibaba'];
    if (!allowed.includes(provider)) return res.status(400).json({ error: 'Invalid provider' });
    await setApiKey('ocr_provider', provider);
    res.json({ success: true, ocrProvider: provider });
});

// GET /api/admin/answer-provider
router.get('/answer-provider', isOwner, async (req, res) => {
    const p = await getApiKey('answer_provider').catch(() => null);
    res.json({ answerProvider: p || process.env.ANSWER_PROVIDER || 'auto' });
});

// POST /api/admin/answer-provider
router.post('/answer-provider', isOwner, async (req, res) => {
    const { provider } = req.body;
    const allowed = ['auto', 'openai', 'kimi', 'alibaba', 'gemini'];
    if (!allowed.includes(provider)) return res.status(400).json({ error: 'Invalid provider' });
    await setApiKey('answer_provider', provider);
    res.json({ success: true, answerProvider: provider });
});

// GET /api/admin/analyze-provider
router.get('/analyze-provider', isOwner, async (req, res) => {
    const p = await getApiKey('analyze_provider').catch(() => null);
    res.json({ analyzeProvider: p || 'auto' });
});

// POST /api/admin/analyze-provider
router.post('/analyze-provider', isOwner, async (req, res) => {
    const { provider } = req.body;
    const allowed = ['auto', 'openai', 'kimi', 'alibaba', 'gemini'];
    if (!allowed.includes(provider)) return res.status(400).json({ error: 'Invalid provider' });
    await setApiKey('analyze_provider', provider);
    res.json({ success: true, analyzeProvider: provider });
});

// GET /api/admin/ocr-prompt
router.get('/ocr-prompt', isOwner, async (req, res) => {
    let prompt = null;
    try { prompt = await getSetting('ocr_text_prompt'); } catch { /* ignore */ }
    res.json({ ocrTextPrompt: prompt });
});

// POST /api/admin/ocr-prompt — save custom OCR prompt template
router.post('/ocr-prompt', isOwner, async (req, res) => {
    const { prompt } = req.body;
    try {
        if (!prompt || prompt.trim() === '') {
            await setSetting('ocr_text_prompt', '');
            return res.json({ success: true, ocrTextPrompt: null });
        }
        await setSetting('ocr_text_prompt', prompt.trim());
        res.json({ success: true, ocrTextPrompt: prompt.trim() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
