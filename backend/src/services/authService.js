// Authentication Service
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import session from 'express-session';

// In-memory user store (used as cache; session holds the full user for persistence across restarts)
const users = new Map();

// Admin emails - can be configured via environment
const adminEmails = (process.env.ADMIN_EMAILS || 'phupn1510@gmail.com').split(',').map(e => e.trim().toLowerCase());

export function configurePassport() {
    // Configure Google OAuth
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        passport.use(new GoogleStrategy({
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback'
        }, (accessToken, refreshToken, profile, done) => {
            try {
                const email = profile.emails?.[0]?.value?.toLowerCase();
                const user = {
                    id: profile.id,
                    name: profile.displayName,
                    email: email,
                    avatar: profile.photos?.[0]?.value,
                    role: adminEmails.includes(email) ? 'admin' : 'user',
                    loginAt: new Date().toISOString()
                };
                
                users.set(user.id, user);
                done(null, user);
            } catch (error) {
                done(error, null);
            }
        }));
    }

    // Serialize user — store full user object in session so it survives server restarts
    passport.serializeUser((user, done) => {
        done(null, user);
    });

    // Deserialize user — restore from session data (also update in-memory cache)
    passport.deserializeUser((user, done) => {
        if (user && user.id) {
            users.set(user.id, user); // refresh in-memory cache
            done(null, user);
        } else {
            done(null, null);
        }
    });
}

export function configureSession(app) {
    app.use(session({
        secret: process.env.SESSION_SECRET || 'ioe-quiz-secret-key-change-in-production',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        }
    }));

    app.use(passport.initialize());
    app.use(passport.session());
}

export function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ error: 'Unauthorized', requiresAuth: true });
}

export function isAdmin(req, res, next) {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Unauthorized', requiresAuth: true });
    }
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden', message: 'Admin access required' });
    }
    next();
}

export function getCurrentUser(req) {
    if (req.isAuthenticated()) {
        return {
            id: req.user.id,
            name: req.user.name,
            email: req.user.email,
            avatar: req.user.avatar,
            role: req.user.role,
            isAdmin: req.user.role === 'admin'
        };
    }
    return null;
}

export default { configurePassport, configureSession, isAuthenticated, isAdmin, getCurrentUser };
