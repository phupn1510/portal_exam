import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import pdfParser from '../services/pdfParser.js';
import { isAuthenticated, isAdmin, getCurrentUser } from '../services/authService.js';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

// In-memory storage (replace with database in production)
const quizzes = new Map();

// Subject categories
const SUBJECTS = {
    english: { id: 'english', name: 'Tiếng Anh', icon: '🇬🇧', color: '#FF6B6B' },
    vietnamese: { id: 'vietnamese', name: 'Tiếng Việt', icon: '🇻🇳', color: '#4ECDC4' },
    math: { id: 'math', name: 'Toán', icon: '🔢', color: '#FFE66D' },
    other: { id: 'other', name: 'Khác', icon: '📚', color: '#95E1D3' }
};

// Upload and parse PDF (Admin only)
router.post('/upload', isAuthenticated, isAdmin, upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No PDF file uploaded' });
        }

        const { subject, title, grade } = req.body;
        
        const fileId = uuidv4();
        const filePath = req.file.path;
        
        console.log(`Processing PDF: ${req.file.originalname} (${fileId})`);
        
        // Parse PDF
        const result = await pdfParser.parsePDF(filePath, fileId);
        
        if (!result.success) {
            return res.status(500).json({ 
                error: 'Failed to parse PDF',
                details: result.error 
            });
        }

        // Determine subject from filename or explicit choice
        let quizSubject = subject || 'other';
        const filenameLower = req.file.originalname.toLowerCase();
        
        if (filenameLower.includes('english') || filenameLower.includes('ioe') || filenameLower.includes('anh')) {
            quizSubject = 'english';
        } else if (filenameLower.includes('vietnam') || filenameLower.includes('việt') || filenameLower.includes('tiếng')) {
            quizSubject = 'vietnamese';
        } else if (filenameLower.includes('math') || filenameLower.includes('toán')) {
            quizSubject = 'math';
        }

        // Store quiz data
        const quiz = {
            id: fileId,
            filename: req.file.originalname,
            title: title || req.file.originalname.replace('.pdf', ''),
            subject: quizSubject,
            grade: grade || '2', // Default to grade 2
            uploadedBy: req.user.email,
            uploadedAt: new Date().toISOString(),
            questions: result.questions,
            questionCount: result.questionCount,
            status: 'ready'
        };
        
        quizzes.set(fileId, quiz);
        
        res.json({
            success: true,
            quiz: {
                id: fileId,
                filename: quiz.filename,
                title: quiz.title,
                subject: quiz.subject,
                grade: quiz.grade,
                questionCount: quiz.questionCount,
                uploadedAt: quiz.uploadedAt,
                status: quiz.status
            }
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get quiz by ID (Public - for taking quiz)
router.get('/:id', (req, res) => {
    const { id } = req.params;
    const quiz = quizzes.get(id);
    
    if (!quiz) {
        return res.status(404).json({ error: 'Quiz not found' });
    }
    
    // Return full quiz for taking
    res.json(quiz);
});

// Get list of all quizzes (Public)
router.get('/', (req, res) => {
    const { subject, grade } = req.query;
    
    let quizList = Array.from(quizzes.values()).map(q => ({
        id: q.id,
        filename: q.filename,
        title: q.title,
        subject: q.subject,
        grade: q.grade,
        questionCount: q.questionCount,
        uploadedAt: q.uploadedAt,
        status: q.status,
        subjectInfo: SUBJECTS[q.subject] || SUBJECTS.other
    }));
    
    // Filter by subject if specified
    if (subject) {
        quizList = quizList.filter(q => q.subject === subject);
    }
    
    // Filter by grade if specified
    if (grade) {
        quizList = quizList.filter(q => q.grade === grade);
    }
    
    res.json(quizList);
});

// Get subjects list
router.get('/meta/subjects', (req, res) => {
    res.json(Object.values(SUBJECTS));
});

// Get grades list
router.get('/meta/grades', (req, res) => {
    res.json([
        { id: '1', name: 'Lớp 1' },
        { id: '2', name: 'Lớp 2' },
        { id: '3', name: 'Lớp 3' },
        { id: '4', name: 'Lớp 4' },
        { id: '5', name: 'Lớp 5' },
        { id: '6', name: 'Lớp 6' },
        { id: '7', name: 'Lớp 7' },
        { id: '8', name: 'Lớp 8' },
        { id: '9', name: 'Lớp 9' },
        { id: '10', name: 'Lớp 10' },
        { id: '11', name: 'Lớp 11' },
        { id: '12', name: 'Lớp 12' }
    ]);
});

// Delete quiz (Admin only)
router.delete('/:id', isAuthenticated, isAdmin, (req, res) => {
    const { id } = req.params;
    
    if (!quizzes.has(id)) {
        return res.status(404).json({ error: 'Quiz not found' });
    }
    
    quizzes.delete(id);
    res.json({ success: true, message: 'Quiz deleted' });
});

export default router;
