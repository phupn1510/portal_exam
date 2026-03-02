import { initDatabase } from './services/database.js';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import passport from 'passport';
import cookieParser from 'cookie-parser';

import pdfRouter from './routes/pdf.js';
import quizRouter from './routes/quiz.js';
import aiRouter from './routes/ai.js';
import authRouter from './routes/auth.js';
import { configurePassport, configureSession, getCurrentUser } from './services/authService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration
const corsOptions = {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// Configure authentication
configurePassport();
configureSession(app);

// Serve uploaded files and images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueId = uuidv4();
        cb(null, `${uniqueId}-${file.originalname}`);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'), false);
        }
    }
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/pdf', pdfRouter);
app.use('/api/quiz', quizRouter);
app.use('/api/ai', aiRouter);

// Get current user
app.get('/api/user', (req, res) => {
    const user = getCurrentUser(req);
    res.json({ user });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        auth: getCurrentUser(req) ? 'authenticated' : 'guest'
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ 
        error: err.message || 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

app.listen(PORT, async () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    
    // Initialize database if DATABASE_URL is present
    if (process.env.DATABASE_URL) {
        try {
            await initDatabase();
            console.log('✅ Database initialized');
        } catch (err) {
            console.log('⚠️ Database init failed (continuing anyway):', err.message);
        }
    }
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📚 API endpoints:`);
    console.log(`   - POST /api/auth/login - Login with Google`);
    console.log(`   - POST /api/auth/logout - Logout`);
    console.log(`   - GET  /api/user - Get current user`);
    console.log(`   - POST /api/pdf/upload - Upload PDF (admin only)`);
    console.log(`   - GET  /api/pdf - List all quizzes (public)`);
    console.log(`   - POST /api/ai/explain - Get AI explanation`);
});

export default app;
