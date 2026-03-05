import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import pdfParser from '../services/pdfParser.js';
import { PROMPT_TEMPLATES } from '../services/aiService.js';
import { isAuthenticated, isAdmin, getCurrentUser } from '../services/authService.js';
import { saveExam, getExams, getExamById, deleteExam, checkExamByHash, savePageImage, getPageImages, getPageImage } from '../services/database.js';
import { createJob, updateJob, getJob, getJobs, stopJob, resumeJob } from '../services/jobService.js';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

// Subject categories
const SUBJECTS = {
    english: { id: 'english', name: 'Tiếng Anh', icon: '🇬🇧', color: '#FF6B6B' },
    vietnamese: { id: 'vietnamese', name: 'Tiếng Việt', icon: '🇻🇳', color: '#4ECDC4' },
    math: { id: 'math', name: 'Toán', icon: '🔢', color: '#FFE66D' },
    other: { id: 'other', name: 'Khác', icon: '📚', color: '#95E1D3' }
};

// Upload and parse PDF (Admin only) — returns jobId immediately, processes in background
router.post('/upload', isAuthenticated, isAdmin, upload.single('pdf'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    const { subject, title, grade, tags: tagsRaw, promptTemplate, customPrompt } = req.body;
    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
    const templateId = promptTemplate && PROMPT_TEMPLATES[promptTemplate] ? promptTemplate : null;
    const userPrompt = customPrompt?.trim() || null;
    const fileId = uuidv4();
    const jobId = uuidv4();
    const filePath = req.file.path;

    // ── Checksum dedup ─────────────────────────────────────────
    const fileBuffer = fs.readFileSync(filePath);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    if (process.env.DATABASE_URL) {
        const existing = await checkExamByHash(fileHash);
        if (existing) {
            fs.unlinkSync(filePath);
            return res.status(409).json({
                error: 'duplicate',
                message: `File này đã được upload trước đó: "${existing.title}" (ID: ${existing.id})`
            });
        }
    }

    // Decode Vietnamese filename (multer encodes as latin1)
    let originalName = req.file.originalname;
    try {
        originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    } catch { /* keep original if decode fails */ }

    console.log(`Processing PDF: ${originalName} (${fileId}) hash=${fileHash.slice(0,12)}... template=${templateId || 'default'} customPrompt=${userPrompt ? 'yes' : 'no'}`);

    createJob(jobId, {
        filePath, fileId, templateId, customPrompt: userPrompt,
        title: title || originalName.replace('.pdf', ''),
        subject: subject || 'other', grade: grade || '2', tags, fileHash,
        userEmail: req.user.email, originalName
    });
    res.json({ success: true, jobId, status: 'processing' });

    // Run OCR/parsing in background
    (async () => {
        try {
            const result = await pdfParser.parsePDF(filePath, fileId, (progress) => {
                updateJob(jobId, progress);
            }, templateId, userPrompt, jobId);

            if (!result.success) {
                updateJob(jobId, { status: 'error', error: result.error || 'Parsing failed' });
                return;
            }

            // Determine subject from filename
            let quizSubject = subject || 'other';
            const filenameLower = originalName.toLowerCase();
            if (filenameLower.includes('english') || filenameLower.includes('ioe') || filenameLower.includes('anh')) {
                quizSubject = 'english';
            } else if (filenameLower.includes('vietnam') || filenameLower.includes('việt') || filenameLower.includes('tiếng')) {
                quizSubject = 'vietnamese';
            } else if (filenameLower.includes('math') || filenameLower.includes('toán') || filenameLower.includes('vioedu')) {
                quizSubject = 'math';
            }

            const quiz = {
                id: fileId,
                filename: originalName,
                title: title || originalName.replace('.pdf', ''),
                subject: quizSubject,
                grade: grade || '2',
                uploadedBy: req.user.email,
                uploadedAt: new Date().toISOString(),
                questions: result.questions,
                questionCount: result.questionCount,
                status: 'ready'
            };

            let examDbId = null;
            if (process.env.DATABASE_URL) {
                examDbId = await saveExam(quiz.title, quizSubject, quiz, req.user.email, fileHash, tags, quiz.grade);
                // Save page images to DB
                if (examDbId && result.pageImages?.length) {
                    for (const pi of result.pageImages) {
                        await savePageImage(examDbId, pi.pageNumber, pi.base64);
                    }
                    console.log(`📸 Saved ${result.pageImages.length} page images for exam ${examDbId}`);
                }
            }

            updateJob(jobId, {
                status: 'done',
                progress: 100,
                total: 100,
                message: `✅ Hoàn thành! ${result.questionCount} câu hỏi`,
                questionCount: result.questionCount,
                result: {
                    id: fileId,
                    title: quiz.title,
                    questionCount: result.questionCount,
                    subject: quizSubject,
                    grade: quiz.grade
                }
            });

        } catch (err) {
            console.error('Background processing error:', err);
            updateJob(jobId, { status: 'error', error: err.message });
        }
    })();
});

// Progress polling endpoint
router.get('/progress/:jobId', (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
});

// Stop a running job
router.post('/stop/:jobId', isAuthenticated, isAdmin, (req, res) => {
    const stopped = stopJob(req.params.jobId);
    if (!stopped) return res.status(400).json({ error: 'Job not running' });
    console.log(`⏹️ Job ${req.params.jobId} stopped by ${req.user.email}`);
    res.json({ success: true, message: 'Job stopped' });
});

// List all jobs (Admin only)
router.get('/jobs/list', isAuthenticated, isAdmin, (req, res) => {
    res.json(getJobs());
});

// Get batch questions for a job
router.get('/jobs/:jobId/questions', isAuthenticated, isAdmin, (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({
        questions: job.questions || [],
        batches: (job.batches || []).map(b => ({
            ...b,
            questions: b.questions?.map(q => ({ number: q.number, text: q.text?.slice(0, 80), type: q.type })) || []
        }))
    });
});

// Get quiz-format data from a job (partial results - for taking quiz while processing)
router.get('/jobs/:jobId/quiz', (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!job.questions || job.questions.length === 0) {
        return res.status(404).json({ error: 'No questions extracted yet' });
    }
    // Add page image URLs for questions with page numbers
    const questions = job.questions.map(q => ({
        ...q,
        imageUrl: q.pageNumber ? `/api/pdf/jobs/${req.params.jobId}/page/${q.pageNumber}` : q.imageUrl
    }));
    res.json({
        id: `job-${job.id}`,
        title: job.meta?.title || 'Đang xử lý...',
        filename: job.meta?.originalName || '',
        subject: job.meta?.subject || 'other',
        grade: job.meta?.grade || '2',
        questions,
        questionCount: questions.length,
        status: job.status,
        isLive: job.status === 'processing',
    });
});

// Serve page image from a job's file images directory
router.get('/jobs/:jobId/page/:pageNum', (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const fileId = job.meta?.fileId;
    if (!fileId) return res.status(404).json({ error: 'No file ID' });

    const pageNum = parseInt(req.params.pageNum);
    const imagesDir = path.join('uploads', 'images', fileId);

    // Look for the page image file (pdftoppm generates page-01.jpg, page-02.jpg, etc.)
    const files = fs.existsSync(imagesDir) ? fs.readdirSync(imagesDir).filter(f => f.startsWith('page') && (f.endsWith('.jpg') || f.endsWith('.jpeg'))).sort() : [];
    const targetFile = files[pageNum - 1];
    if (!targetFile) return res.status(404).json({ error: 'Page image not found' });

    const imgPath = path.join(imagesDir, targetFile);
    if (!fs.existsSync(imgPath)) return res.status(404).json({ error: 'Page image file missing' });

    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600' });
    res.sendFile(path.resolve(imgPath));
});

// Resume a stopped/failed job
router.post('/resume/:jobId', isAuthenticated, isAdmin, async (req, res) => {
    const job = resumeJob(req.params.jobId);
    if (!job) return res.status(400).json({ error: 'Job cannot be resumed' });

    const { filePath, fileId, templateId, customPrompt, fileHash, userEmail, originalName,
            title, subject, grade, tags, fileImagesDir } = job.meta;

    // Check file still exists
    if (!filePath || !fs.existsSync(filePath)) {
        updateJob(job.id, { status: 'error', error: 'PDF file no longer available' });
        return res.status(400).json({ error: 'PDF file no longer available' });
    }

    const lastBatch = job.batches?.length || 0;
    console.log(`▶️ Resuming job ${job.id} from batch ${lastBatch + 1}`);
    res.json({ success: true, jobId: job.id, resumeFromBatch: lastBatch });

    // Run in background
    (async () => {
        try {
            const result = await pdfParser.parsePDF(filePath, fileId, (progress) => {
                updateJob(job.id, progress);
            }, templateId, customPrompt, job.id, lastBatch);

            if (!result.success) {
                updateJob(job.id, { status: 'error', error: result.error || 'Parsing failed' });
                return;
            }

            // Determine subject from filename
            let quizSubject = subject || 'other';
            const filenameLower = (originalName || '').toLowerCase();
            if (filenameLower.includes('english') || filenameLower.includes('ioe') || filenameLower.includes('anh')) {
                quizSubject = 'english';
            } else if (filenameLower.includes('vietnam') || filenameLower.includes('việt')) {
                quizSubject = 'vietnamese';
            } else if (filenameLower.includes('math') || filenameLower.includes('toán') || filenameLower.includes('vioedu')) {
                quizSubject = 'math';
            }

            const quiz = {
                id: fileId,
                filename: originalName,
                title: title || (originalName || '').replace('.pdf', ''),
                subject: quizSubject,
                grade: grade || '2',
                uploadedBy: userEmail,
                uploadedAt: new Date().toISOString(),
                questions: result.questions,
                questionCount: result.questionCount,
                status: 'ready'
            };

            let examDbId = null;
            if (process.env.DATABASE_URL) {
                examDbId = await saveExam(quiz.title, quizSubject, quiz, userEmail, fileHash, tags || [], quiz.grade);
                if (examDbId && result.pageImages?.length) {
                    for (const pi of result.pageImages) {
                        await savePageImage(examDbId, pi.pageNumber, pi.base64);
                    }
                }
            }

            updateJob(job.id, {
                status: 'done',
                progress: 100,
                total: 100,
                message: `Hoàn thành! ${result.questionCount} câu hỏi`,
                questionCount: result.questionCount,
                result: { id: fileId, title: quiz.title, questionCount: result.questionCount, subject: quizSubject, grade: quiz.grade }
            });
        } catch (err) {
            console.error('Resume processing error:', err);
            updateJob(job.id, { status: 'error', error: err.message });
        }
    })();
});

// Get quiz by ID (Public - for taking quiz)
router.get('/:id', async (req, res) => {
    const { id } = req.params;

    // Try database first
    if (process.env.DATABASE_URL) {
        const exam = await getExamById(id);
        if (exam) {
            const quiz = exam.questions;
            quiz.id = exam.id;
            // Add page image URLs for questions that have page numbers
            if (quiz.questions) {
                quiz.questions.forEach(q => {
                    if (q.pageNumber) {
                        q.imageUrl = `/api/pdf/${exam.id}/page/${q.pageNumber}`;
                    }
                });
            }
            return res.json(quiz);
        }
    }

    res.status(404).json({ error: 'Quiz not found' });
});

// Get list of all quizzes (Public)
router.get('/', async (req, res) => {
    const { subject, grade } = req.query;
    
    let quizList = [];
    
    // Try database first
    if (process.env.DATABASE_URL) {
        const exams = await getExams();
        quizList = exams.map(e => ({
            id: e.id,
            title: e.title,
            subject: e.subject,
            grade: e.grade || '2',
            tags: e.tags || [],
            uploadedAt: e.created_at,
            subjectInfo: SUBJECTS[e.subject] || SUBJECTS.other
        }));
    }
    
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

// Get page images list for an exam
router.get('/:id/pages', async (req, res) => {
    const { id } = req.params;
    if (!process.env.DATABASE_URL) return res.json([]);
    const pages = await getPageImages(id);
    res.json(pages.map(p => ({ pageNumber: p.page_number })));
});

// Get a specific page image (returns JPEG)
router.get('/:id/page/:pageNum', async (req, res) => {
    const { id, pageNum } = req.params;
    if (!process.env.DATABASE_URL) return res.status(404).json({ error: 'No images' });
    const base64 = await getPageImage(id, parseInt(pageNum));
    if (!base64) return res.status(404).json({ error: 'Page image not found' });
    const buffer = Buffer.from(base64, 'base64');
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
    res.send(buffer);
});

// Get prompt templates list (includes prompt text for preview/edit)
router.get('/meta/templates', (req, res) => {
    const list = Object.values(PROMPT_TEMPLATES).map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        promptText: t.text || '',
        promptVision: t.vision || ''
    }));
    res.json(list);
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
router.delete('/:id', isAuthenticated, isAdmin, async (req, res) => {
    const { id } = req.params;
    
    if (process.env.DATABASE_URL) {
        await deleteExam(id);
    }
    
    res.json({ success: true, message: 'Quiz deleted' });
});

export default router;
