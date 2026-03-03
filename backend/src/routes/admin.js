import express from 'express';
import { isAuthenticated } from '../services/authService.js';
import { getAdminEmails, addAdminEmail, removeAdminEmail, getApiKey, setApiKey } from '../services/database.js';

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
        const providers = ['openai', 'kimi', 'gemini'];
        const keys = {};
        for (const p of providers) {
            const key = await getApiKey(p);
            keys[p] = key ? `${key.slice(0, 8)}${'*'.repeat(12)}` : null; // masked
        }
        res.json({ adminEmails: emails, apiKeys: keys, ownerEmail: OWNER_EMAIL });
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
    const allowed = ['openai', 'kimi', 'gemini'];
    if (!allowed.includes(provider)) return res.status(400).json({ error: 'Invalid provider' });
    if (!key || key.length < 10) return res.status(400).json({ error: 'Key too short' });
    try {
        await setApiKey(provider, key.trim());
        res.json({ success: true, provider });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
