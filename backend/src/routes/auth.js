import express from 'express';
import passport from 'passport';
import { isAuthenticated, isAdmin, getCurrentUser } from '../services/authService.js';

const router = express.Router();

// Login with Google
router.get('/google', passport.authenticate('google', { 
    scope: ['profile', 'email']
}));

// Google OAuth callback
router.get('/google/callback', 
    passport.authenticate('google', { 
        failureRedirect: '/login?error=auth_failed' 
    }),
    (req, res) => {
        // Redirect to frontend with success
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        res.redirect(`${frontendUrl}/?success=true`);
    }
);

// Logout
router.get('/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.json({ success: true, message: 'Logged out successfully' });
    });
});

// Get current user
router.get('/me', (req, res) => {
    const user = getCurrentUser(req);
    res.json({ user });
});

// Check if user is admin
router.get('/admin-check', isAuthenticated, (req, res) => {
    res.json({ 
        isAdmin: req.user.role === 'admin',
        role: req.user.role 
    });
});

export default router;
