// PDF Parsing Service - AI-powered with OCR fallback
import pdf from 'pdf-parse';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { exec } from 'child_process';
import { promisify } from 'util';
import aiService from './aiService.js';

const execAsync = promisify(exec);

class PDFParser {
    constructor() {
        this.uploadDir = './uploads';
        this.imagesDir = './uploads/images';
    }

    async parsePDF(filePath, fileId, onProgress = null) {
        try {
            const fileImagesDir = path.join(this.imagesDir, fileId);
            if (!fs.existsSync(fileImagesDir)) {
                fs.mkdirSync(fileImagesDir, { recursive: true });
            }

            // Step 1: Try text extraction with pdf-parse
            onProgress?.({ progress: 0, total: 100, message: '📄 Đang đọc file PDF...' });
            const dataBuffer = fs.readFileSync(filePath);
            const pdfData = await pdf(dataBuffer);
            const fullText = (pdfData.text || '').trim();

            console.log(`PDF: ${pdfData.numpages} pages, extracted ${fullText.length} chars of text`);

            // Step 2: Choose parsing strategy
            const minTextPerPage = 50;
            const hasEnoughText = fullText.length > pdfData.numpages * minTextPerPage;

            let questions = [];

            if (hasEnoughText) {
                // Text-based PDF → AI text parsing
                const provider = await aiService.resolveOcrProvider();
                console.log(`Strategy: AI text parsing [provider=${provider}]`);
                onProgress?.({ progress: 10, total: 100, message: `🤖 PDF có văn bản — đang phân tích bằng AI (${provider})...` });
                questions = await this.parseWithAIText(fullText, pdfData.numpages, onProgress);
            } else {
                // Image-based PDF (scanned) → Vision OCR
                console.log('Strategy: AI Vision OCR (scanned PDF detected)');
                onProgress?.({ progress: 5, total: 100, message: '🖼️ PDF dạng ảnh — đang chuyển đổi sang hình ảnh...' });
                questions = await this.parseWithVision(filePath, fileId, fileImagesDir, pdfData.numpages, onProgress);
            } else {
                // Fallback: basic regex (no OpenAI key)
                console.log('Strategy: Regex fallback (no OpenAI key configured)');
                onProgress?.({ progress: 50, total: 100, message: '📝 Đang trích xuất câu hỏi...' });
                questions = this.parseQuestionsFromText(fullText);
            }

            console.log(`✅ Parsed ${questions.length} questions`);
            onProgress?.({ progress: 100, total: 100, message: `✅ Hoàn thành! Tìm thấy ${questions.length} câu hỏi`, questionCount: questions.length });

            return {
                success: true,
                questionCount: questions.length,
                questions,
                pagesProcessed: pdfData.numpages
            };

        } catch (error) {
            console.error('PDF parsing error:', error);
            return { success: false, error: error.message };
        }
    }

    // ─── AI Text Parsing ──────────────────────────────────────────────────────

    async parseWithAIText(text, numPages, onProgress) {
        const chunkSize = 3000;
        const chunks = [];
        for (let i = 0; i < text.length; i += chunkSize) {
            chunks.push(text.slice(i, i + chunkSize));
        }

        const allQuestions = [];

        for (let i = 0; i < chunks.length; i++) {
            const pct = Math.round(10 + ((i + 1) / chunks.length) * 85);
            onProgress?.({ progress: pct, total: 100, message: `🤖 Phân tích đoạn văn bản ${i + 1}/${chunks.length}...` });
            console.log(`  Parsing text chunk ${i + 1}/${chunks.length}...`);
            const questions = await this.extractQuestionsFromText(chunks[i]);
            allQuestions.push(...questions);
        }

        const seen = new Set();
        return allQuestions.filter(q => {
            if (seen.has(q.number)) return false;
            seen.add(q.number);
            return true;
        });
    }

    async extractQuestionsFromText(text) {
        // Delegate to aiService — handles provider selection + logging
        const raw = await aiService.parseQuestionsFromText(text);
        return raw.map(q => ({
            id: uuidv4(),
            number: q.number || 0,
            text: q.text || '',
            options: (q.options || []).map(o => ({ letter: o.letter, text: o.text })),
            correctAnswer: null,
            type: q.type === 'listening' ? 'listening' : 'reading',
            imageUrl: null
        }));
    }

    // ─── AI Vision Parsing (for scanned/image PDFs) ───────────────────────────

    async parseWithVision(filePath, fileId, fileImagesDir, numPages, onProgress) {
        const hasPdftoppm = await this.checkPdftoppm();
        if (!hasPdftoppm) {
            console.warn('pdftoppm not found — falling back to regex parser');
            return [];
        }

        const maxPages = Math.min(numPages, 20);
        const outputBase = path.join(fileImagesDir, 'page');

        try {
            onProgress?.({ progress: 10, total: 100, message: `🖼️ Đang chuyển ${maxPages} trang thành hình ảnh...` });
            console.log(`Converting ${maxPages} pages to images...`);
            await execAsync(
                `pdftoppm -r 150 -jpeg -jpegopt quality=80 -l ${maxPages} "${filePath}" "${outputBase}"`
            );
        } catch (err) {
            console.error('pdftoppm failed:', err.message);
            return [];
        }

        const imageFiles = fs.readdirSync(fileImagesDir)
            .filter(f => f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.ppm'))
            .sort()
            .map(f => path.join(fileImagesDir, f));

        console.log(`Generated ${imageFiles.length} page images`);

        const batchSize = 4;
        const totalBatches = Math.ceil(imageFiles.length / batchSize);
        const allQuestions = [];

        for (let i = 0; i < imageFiles.length; i += batchSize) {
            const batchNum = Math.floor(i / batchSize) + 1;
            const pagesFrom = i + 1;
            const pagesTo = Math.min(i + batchSize, imageFiles.length);
            const pct = Math.round(20 + (batchNum / totalBatches) * 75);

            onProgress?.({
                progress: pct,
                total: 100,
                message: `🔍 OCR trang ${pagesFrom}–${pagesTo} / ${imageFiles.length} (batch ${batchNum}/${totalBatches})...`
            });

            const batch = imageFiles.slice(i, i + batchSize);
            console.log(`  OCR batch ${batchNum}: pages ${pagesFrom}-${pagesTo}`);
            const questions = await this.extractQuestionsFromImages(batch);
            allQuestions.push(...questions);
        }

        try {
            imageFiles.forEach(f => fs.unlinkSync(f));
        } catch (_) { /* ignore cleanup errors */ }

        const seen = new Set();
        return allQuestions.filter(q => {
            if (seen.has(q.number)) return false;
            seen.add(q.number);
            return true;
        });
    }

    async extractQuestionsFromImages(imagePaths) {
        // Read files as base64 and delegate to aiService (handles provider selection)
        const base64Images = imagePaths.map(p => fs.readFileSync(p).toString('base64'));
        const raw = await aiService.parseQuestionsFromImages(base64Images);
        return raw.map(q => ({
            id: uuidv4(),
            number: q.number || 0,
            text: q.text || '',
            options: (q.options || []).map(o => ({ letter: o.letter, text: o.text })),
            correctAnswer: null,
            type: q.type === 'listening' ? 'listening' : 'reading',
            imageUrl: null
        }));
    }


    // ─── Helpers ──────────────────────────────────────────────────────────────

    async checkPdftoppm() {
        try {
            await execAsync('which pdftoppm');
            return true;
        } catch {
            return false;
        }
    }

    // Fallback regex parser (when no OpenAI key)
    parseQuestionsFromText(text) {
        const questions = [];
        const lines = text.split('\n');
        const questionPattern = /^(\d+)[\.)\s]\s*(.+)/;
        let currentQuestion = null;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const match = trimmed.match(questionPattern);
            if (match) {
                if (currentQuestion) questions.push(currentQuestion);
                currentQuestion = {
                    id: uuidv4(),
                    number: parseInt(match[1]),
                    text: match[2].trim(),
                    options: [],
                    correctAnswer: null,
                    type: 'reading',
                    imageUrl: null
                };
            } else if (currentQuestion) {
                const optionMatch = trimmed.match(/^([A-D])[\.)\s]\s*(.+)/i);
                if (optionMatch) {
                    currentQuestion.options.push({
                        letter: optionMatch[1].toUpperCase(),
                        text: optionMatch[2].trim()
                    });
                }
            }
        }

        if (currentQuestion) questions.push(currentQuestion);
        return questions;
    }
}

export default new PDFParser();
