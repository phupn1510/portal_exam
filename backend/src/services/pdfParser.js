// PDF Parsing Service - AI-powered with OCR fallback
import pdf from 'pdf-parse';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { exec } from 'child_process';
import { promisify } from 'util';
import aiService from './aiService.js';
import { isJobStopped, updateJob, getJob } from './jobService.js';

const execAsync = promisify(exec);

class PDFParser {
    constructor() {
        this.uploadDir = './uploads';
        this.imagesDir = './uploads/images';
    }

    /**
     * Pre-clean extracted PDF text: remove watermarks, ads, broken vertical text,
     * phone numbers, and other noise common in Vietnamese exam PDFs.
     */
    _cleanExtractedText(text) {
        return text
            // Remove common ad/watermark lines
            .replace(/Liên hệ.*?(?:zalo|0\d{9}).*$/gm, '')
            .replace(/Tài liệu ôn thi.*$/gm, '')
            .replace(/CẬP NHẬT TÀI LIỆU.*$/gm, '')
            .replace(/Quét QR.*$/gm, '')
            .replace(/Team Cô Hoa.*$/gm, '')
            .replace(/Nam Thắng.*$/gm, '')
            .replace(/Kính gửi Quý phụ huynh.*?Trân trọng!/gs, '')
            .replace(/0\d{9}[-.]?.*$/gm, '')
            .replace(/100%\s*free/gi, '')
            // Remove broken vertical watermark fragments (1-4 char lines)
            .replace(/^[a-zA-ZàáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđĐ]{1,4}$/gm, '')
            // Remove lines that are just dashes, equals, or whitespace
            .replace(/^[=\-_\s]+$/gm, '')
            // Collapse multiple blank lines
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    /**
     * Smart chunking: split text by ĐỀ SỐ boundaries when possible,
     * keeping each chunk under maxChunkSize. Never splits a question in half.
     */
    _smartChunk(text, maxChunkSize = 6000) {
        const deParts = text.split(/(?=ĐỀ SỐ\s+\d+)/);
        const chunks = [];
        let current = '';

        for (const part of deParts) {
            if (current.length + part.length > maxChunkSize && current.length > 0) {
                chunks.push(current.trim());
                current = part;
            } else {
                current += part;
            }
        }
        if (current.trim()) chunks.push(current.trim());

        return chunks.length > 0 ? chunks : [text];
    }

    async parsePDF(filePath, fileId, onProgress = null, templateId = null, customPrompt = null, jobId = null, resumeFromBatch = 0) {
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
                questions = await this.parseWithAIText(fullText, pdfData.numpages, onProgress, templateId, customPrompt, jobId, resumeFromBatch);
            } else {
                // Image-based PDF (scanned) → Vision OCR
                const provider = await aiService.resolveOcrProvider();
                console.log(`Strategy: AI Vision OCR (scanned PDF) [provider=${provider}]`);
                onProgress?.({ progress: 5, total: 100, message: `🖼️ PDF dạng ảnh — đang chuyển đổi (${provider})...` });
                questions = await this.parseWithVision(filePath, fileId, fileImagesDir, pdfData.numpages, onProgress, templateId, jobId, resumeFromBatch);
            }


            // Filter out listening questions (can't play audio on web)
            const before = questions.length;
            questions = questions.filter(q => {
                if (q.type === 'listening') return false;
                const txt = (q.text || '').toLowerCase();
                if (txt.includes('nhấn giữ ctrl') || txt.includes('bấm chuột để nghe') || txt.includes('nhận giữ ctrl')) return false;
                return true;
            });
            if (questions.length < before) {
                console.log(`🎧 Filtered ${before - questions.length} listening questions`);
                // Re-number after filtering
                questions.forEach((q, i) => { q.number = i + 1; });
            }

            console.log(`✅ Parsed ${questions.length} questions`);

            // Generate page images for the quiz viewer
            let pageImages = [];
            try {
                pageImages = await this.generatePageImages(filePath, fileId, fileImagesDir, pdfData.numpages);
                console.log(`📸 Generated ${pageImages.length} page images`);
            } catch (err) {
                console.warn('⚠️ Could not generate page images:', err.message);
            }

            onProgress?.({ progress: 100, total: 100, message: `✅ Hoàn thành! Tìm thấy ${questions.length} câu hỏi`, questionCount: questions.length });

            return {
                success: true,
                questionCount: questions.length,
                questions,
                pageImages,
                pagesProcessed: pdfData.numpages
            };

        } catch (error) {
            console.error('PDF parsing error:', error);
            return { success: false, error: error.message };
        }
    }

    // ─── AI Text Parsing ──────────────────────────────────────────────────────

    async parseWithAIText(text, numPages, onProgress, templateId = null, customPrompt = null, jobId = null, resumeFromBatch = 0) {
        // Pre-clean text to remove watermarks, ads, noise
        const cleaned = this._cleanExtractedText(text);
        console.log(`Text after cleaning: ${cleaned.length} chars (was ${text.length})`);

        // Smart chunking by ĐỀ SỐ boundaries
        const chunks = this._smartChunk(cleaned);
        console.log(`Split into ${chunks.length} chunks`);

        const existingJob = jobId ? getJob(jobId) : null;
        const allQuestions = existingJob?.questions?.slice() || [];
        const batches = existingJob?.batches?.slice() || [];

        for (let i = resumeFromBatch; i < chunks.length; i++) {
            // Check if job was stopped
            if (jobId && isJobStopped(jobId)) {
                console.log(`⏹️ Job ${jobId} stopped at chunk ${i + 1}/${chunks.length}`);
                break;
            }

            const pct = Math.round(10 + ((i + 1) / chunks.length) * 85);
            onProgress?.({ progress: pct, total: 100, message: `🤖 Phân tích đoạn văn bản ${i + 1}/${chunks.length}...` });
            console.log(`  Parsing text chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)...`);
            const questions = await this.extractQuestionsFromText(chunks[i], templateId, customPrompt);
            allQuestions.push(...questions);

            const batchInfo = { batch: i + 1, totalBatches: chunks.length, questionCount: questions.length, questions };
            batches.push(batchInfo);

            if (jobId) {
                updateJob(jobId, { questions: allQuestions, batches, questionCount: allQuestions.length, 'meta.lastBatchIndex': i + 1 });
            }

            onProgress?.({ progress: pct, total: 100, message: `🤖 Đoạn ${i + 1}/${chunks.length}: +${questions.length} câu (tổng: ${allQuestions.length})`, batches, questionCount: allQuestions.length });
        }

        // Deduplicate by (deNumber, originalCau) combo, then re-number globally
        const seen = new Set();
        const deduped = allQuestions.filter(q => {
            const key = `${q.deNumber || 0}-${q.originalCau ?? q.number}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        // Re-assign continuous global numbering after dedup
        deduped.forEach((q, i) => { q.number = i + 1; });
        return deduped;
    }

    async extractQuestionsFromText(text, templateId = null, customPrompt = null) {
        // Step 1: OCR — extract raw data
        const raw = await aiService.parseQuestionsFromText(text, null, templateId, customPrompt);
        if (!raw || raw.length === 0) return [];

        // Step 2: Analyze — classify types, verify, mark interactive
        const provider = await aiService.resolveAnalyzeProvider();
        console.log(`[Analyze] Running question analysis with ${provider}...`);
        const analyzed = await aiService.analyzeExtractedQuestions(raw, provider);

        return this._normalizeOcrResponse(analyzed);
    }

    // ─── AI Vision Parsing (for scanned/image PDFs) ───────────────────────────

    async parseWithVision(filePath, fileId, fileImagesDir, numPages, onProgress, templateId = null, jobId = null, resumeFromBatch = 0) {
        const hasPdftoppm = await this.checkPdftoppm();
        if (!hasPdftoppm) {
            console.warn('pdftoppm not found — falling back to regex parser');
            return [];
        }

        const maxPages = Math.min(numPages, 80);
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

        // Resume support: pick up existing questions and batches from job
        const existingJob = jobId ? getJob(jobId) : null;
        const startBatchIndex = resumeFromBatch > 0 ? resumeFromBatch : 0;
        const allQuestions = existingJob?.questions?.slice() || [];
        const batches = existingJob?.batches?.slice() || [];

        for (let i = startBatchIndex * batchSize; i < imageFiles.length; i += batchSize) {
            // Check if job was stopped
            if (jobId && isJobStopped(jobId)) {
                console.log(`⏹️ Job ${jobId} stopped at batch ${Math.floor(i / batchSize) + 1}/${totalBatches}`);
                break;
            }

            const batchNum = Math.floor(i / batchSize) + 1;
            const pagesFrom = i + 1;
            const pagesTo = Math.min(i + batchSize, imageFiles.length);
            const pct = Math.round(20 + (batchNum / totalBatches) * 75);

            onProgress?.({
                progress: pct,
                total: 100,
                message: `🔍 OCR trang ${pagesFrom}–${pagesTo} / ${imageFiles.length} (batch ${batchNum}/${totalBatches})...`,
                batches,
                questionCount: allQuestions.length
            });

            const batch = imageFiles.slice(i, i + batchSize);
            console.log(`  OCR batch ${batchNum}: pages ${pagesFrom}-${pagesTo}`);

            // Add delay between batches to avoid rate limiting (skip for first batch)
            if (batchNum > 1 + startBatchIndex) {
                await new Promise(r => setTimeout(r, 1500));
            }

            const questions = await this.extractQuestionsFromImages(batch, templateId);
            allQuestions.push(...questions);
            if (questions.length === 0) {
                console.warn(`  ⚠️ Batch ${batchNum} returned 0 questions from pages ${pagesFrom}-${pagesTo}`);
            }

            const batchInfo = { batch: batchNum, totalBatches, pages: `${pagesFrom}–${pagesTo}`, questionCount: questions.length, questions };
            batches.push(batchInfo);

            // Persist to job store (for resume & live preview)
            if (jobId) {
                updateJob(jobId, { questions: allQuestions, batches, questionCount: allQuestions.length, 'meta.lastBatchIndex': batchNum });
            }

            onProgress?.({
                progress: pct,
                total: 100,
                message: `🔍 Batch ${batchNum}/${totalBatches}: +${questions.length} câu (tổng: ${allQuestions.length})`,
                batches,
                questionCount: allQuestions.length
            });
        }

        try {
            imageFiles.forEach(f => fs.unlinkSync(f));
        } catch (_) { /* ignore cleanup errors */ }

        const seen = new Set();
        const deduped = allQuestions.filter(q => {
            const key = `${q.deNumber || 0}-${q.originalCau ?? q.number}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        deduped.forEach((q, i) => { q.number = i + 1; });
        return deduped;
    }

    async extractQuestionsFromImages(imagePaths, templateId = null) {
        // Step 1: OCR with retry
        const base64Images = imagePaths.map(p => fs.readFileSync(p).toString('base64'));
        let raw = null;
        let lastError = null;

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                raw = await aiService.parseQuestionsFromImages(base64Images, null, templateId);
                if (raw && raw.length > 0) break;
                console.warn(`  OCR attempt ${attempt}: returned ${raw?.length || 0} questions`);
            } catch (err) {
                lastError = err;
                console.warn(`  OCR attempt ${attempt} failed: ${err.message}`);
            }
            // Wait before retry (exponential backoff)
            if (attempt < 3) {
                const delay = attempt * 2000;
                console.log(`  Retrying in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
            }
        }

        if (!raw || raw.length === 0) {
            console.warn(`  OCR failed after 3 attempts: ${lastError?.message || 'empty result'}`);
            return [];
        }

        // Step 2: Analyze (run once per batch, not per page)
        const provider = await aiService.resolveAnalyzeProvider();
        const analyzed = await aiService.analyzeExtractedQuestions(raw, provider);

        return this._normalizeOcrResponse(analyzed);
    }

    /**
     * Normalize AI response to a flat array of quiz question objects.
     * Handles three formats:
     *   A) Legacy MCQ: [{ number, text, type, options:[{letter,text}] }]
     *   B) Raw OCR (nested): [{ de_so, questions:[{ cau, dap_an, giai_thich }] }]
     *   C) Analyzed (flat): [{ de_so, cau, type, interactive, correct, options, giai_thich }]
     */
    _normalizeOcrResponse(raw) {
        if (!Array.isArray(raw) || raw.length === 0) return [];

        const first = raw[0];

        // Format C: flat analyzed output (has cau + type at top level, no nested questions array)
        if (first && first.cau !== undefined && first.type !== undefined && !first.questions) {
            // Use continuous global numbering (1, 2, 3, ...) across all exam sets
            return raw.map((q, i) => ({
                id: uuidv4(),
                number: i + 1,
                deNumber: q.de_so ?? 1,
                originalCau: q.cau,
                text: q.noi_dung || q.giai_thich || q.dap_an || '',
                explanation: q.giai_thich || '',
                options: (q.options || []).map(o => ({ letter: o.letter, text: o.text })),
                correctAnswer: q.correct || q.dap_an || null,
                type: q.type || 'reading',
                interactive: q.interactive !== false,
                imageUrl: null
            }));
        }

        // Format B: nested de_so/questions (raw OCR output, no analyze step)
        if (first && (first.de_so !== undefined || first.questions)) {
            const result = [];
            let globalIndex = 1;
            for (const de of raw) {
                const deNum = de.de_so ?? globalIndex;
                for (const q of (de.questions || [])) {
                    result.push({
                        id: uuidv4(),
                        number: globalIndex,
                        deNumber: deNum,
                        originalCau: q.cau,
                        text: q.noi_dung || q.giai_thich || q.dap_an || '',
                        explanation: q.giai_thich || '',
                        options: (q.options || []).map(o => ({ letter: o.letter, text: o.text })),
                        correctAnswer: q.dap_an || null,
                        type: q.type || 'reading',
                        interactive: (q.options || []).length > 0,
                        imageUrl: null
                    });
                    globalIndex++;
                }
            }
            return result;
        }

        // Format A: legacy MCQ (IOE format)
        return raw.map(q => ({
            id: uuidv4(),
            number: q.number || 0,
            deNumber: null,
            text: q.text || '',
            explanation: '',
            options: (q.options || []).map(o => ({ letter: o.letter, text: o.text })),
            correctAnswer: null,
            type: q.type === 'listening' ? 'listening' : 'reading',
            interactive: (q.options || []).length > 0,
            imageUrl: null
        }));
    }



    // ─── Page Image Generation ─────────────────────────────────────────────────

    async generatePageImages(filePath, fileId, fileImagesDir, numPages) {
        const hasPdftoppm = await this.checkPdftoppm();
        if (!hasPdftoppm) return [];

        if (!fs.existsSync(fileImagesDir)) {
            fs.mkdirSync(fileImagesDir, { recursive: true });
        }

        const maxPages = Math.min(numPages, 30);
        const outputBase = path.join(fileImagesDir, 'pg');

        try {
            // Lower DPI (100) for smaller file sizes, JPEG quality 70
            await execAsync(
                `pdftoppm -r 100 -jpeg -jpegopt quality=70 -l ${maxPages} "${filePath}" "${outputBase}"`
            );
        } catch (err) {
            console.warn('pdftoppm failed for page images:', err.message);
            return [];
        }

        const imageFiles = fs.readdirSync(fileImagesDir)
            .filter(f => f.startsWith('pg') && (f.endsWith('.jpg') || f.endsWith('.jpeg')))
            .sort();

        const pageImages = [];
        for (let i = 0; i < imageFiles.length; i++) {
            const imgPath = path.join(fileImagesDir, imageFiles[i]);
            const base64 = fs.readFileSync(imgPath).toString('base64');
            pageImages.push({ pageNumber: i + 1, base64 });
            fs.unlinkSync(imgPath); // clean up file after reading
        }

        return pageImages;
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
