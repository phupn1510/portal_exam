import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import pdfParser from '../services/pdfParser.js';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

// In-memory storage (replace with database in production)
const quizzes = new Map();

// Upload and parse PDF
router.post('/upload', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No PDF file uploaded' });
        }

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

        // Store quiz data
        const quiz = {
            id: fileId,
            filename: req.file.originalname,
            uploadedAt: new Date().toISOString(),
            questions: result.questions,
            questionCount: result.questionCount,
            status: 'ready'
        };
        
        quizzes.set(fileId, quiz);
        
        // Clean up uploaded file (keep images)
        // fs.unlinkSync(filePath);
        
        res.json({
            success: true,
            quiz: {
                id: fileId,
                filename: quiz.filename,
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

// Get quiz by ID
router.get('/:id', (req, res) => {
    const { id } = req.params;
    const quiz = quizzes.get(id);
    
    if (!quiz) {
        return res.status(404).json({ error: 'Quiz not found' });
    }
    
    // Return quiz without images (send image URLs instead)
    const sanitizedQuiz = {
        ...quiz,
        questions: quiz.questions.map(q => ({
            ...q,
            imageUrl: q.imageUrl ? `/api/pdf/images/${id}/${path.basename(q.imageUrl)}` : null
        }))
    };
    
    res.json(sanitizedQuiz);
});

// Get list of all quizzes
router.get('/', (req, res) => {
    const quizList = Array.from(quizzes.values()).map(q => ({
        id: q.id,
        filename: q.filename,
        questionCount: q.questionCount,
        uploadedAt: q.uploadedAt,
        status: q.status
    }));
    
    res.json(quizList);
});

// Delete quiz
router.delete('/:id', (req, res) => {
    const { id } = req.params;
    
    if (!quizzes.has(id)) {
        return res.status(404).json({ error: 'Quiz not found' });
    }
    
    quizzes.delete(id);
    res.json({ success: true, message: 'Quiz deleted' });
});

// Get image for a question
router.get('/images/:quizId/:imageName', (req, res) => {
    const { quizId, imageName } = req.params;
    const imagePath = path.join('./uploads/images', quizId, imageName);
    
    if (fs.existsSync(imagePath)) {
        res.sendFile(path.resolve(imagePath));
    } else {
        res.status(404).json({ error: 'Image not found' });
    }
});

export default router;
