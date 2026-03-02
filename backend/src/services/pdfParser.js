// PDF Parsing Service - AI-powered with OCR fallback
import pdf from 'pdf-parse';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { exec } from 'child_process';
import { promisify } from 'util';
import OpenAI from 'openai';

const execAsync = promisify(exec);

class PDFParser {
    constructor() {
        this.uploadDir = './uploads';
        this.imagesDir = './uploads/images';
        this.openai = process.env.OPENAI_API_KEY
            ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
            : null;
    }

    async parsePDF(filePath, fileId) {
        try {
            const fileImagesDir = path.join(this.imagesDir, fileId);
            if (!fs.existsSync(fileImagesDir)) {
                fs.mkdirSync(fileImagesDir, { recursive: true });
            }

            // Step 1: Try text extraction with pdf-parse
            const dataBuffer = fs.readFileSync(filePath);
            const pdfData = await pdf(dataBuffer);
            const fullText = (pdfData.text || '').trim();

            console.log(`PDF: ${pdfData.numpages} pages, extracted ${fullText.length} chars of text`);

            // Step 2: Choose parsing strategy
            const minTextPerPage = 50;
            const hasEnoughText = fullText.length > pdfData.numpages * minTextPerPage;

            let questions = [];

            if (hasEnoughText && this.openai) {
                // Text-based PDF → AI text parsing
                console.log('Strategy: AI text parsing');
                questions = await this.parseWithAIText(fullText, pdfData.numpages);
            } else if (this.openai) {
                // Image-based PDF (scanned) → Vision OCR
                console.log('Strategy: AI Vision OCR (scanned PDF detected)');
                questions = await this.parseWithVision(filePath, fileId, fileImagesDir, pdfData.numpages);
            } else {
                // Fallback: basic regex (no OpenAI key)
                console.log('Strategy: Regex fallback (no OpenAI key configured)');
                questions = this.parseQuestionsFromText(fullText);
            }

            console.log(`✅ Parsed ${questions.length} questions`);

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

    async parseWithAIText(text, numPages) {
        // Split into chunks of ~3000 chars to stay within token limits
        const chunkSize = 3000;
        const chunks = [];
        for (let i = 0; i < text.length; i += chunkSize) {
            chunks.push(text.slice(i, i + chunkSize));
        }

        const allQuestions = [];

        for (let i = 0; i < chunks.length; i++) {
            console.log(`  Parsing text chunk ${i + 1}/${chunks.length}...`);
            const questions = await this.extractQuestionsFromText(chunks[i]);
            allQuestions.push(...questions);
        }

        // Deduplicate by question number
        const seen = new Set();
        return allQuestions.filter(q => {
            if (seen.has(q.number)) return false;
            seen.add(q.number);
            return true;
        });
    }

    async extractQuestionsFromText(text) {
        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `You are an expert at parsing Vietnamese IOE (International Olympiad of English) exam papers.
Extract ALL multiple-choice questions from the text.
Return ONLY a valid JSON array. Each element must have:
{
  "number": <integer>,
  "text": "<question text>",
  "options": [
    {"letter": "A", "text": "<option text>"},
    {"letter": "B", "text": "<option text>"},
    {"letter": "C", "text": "<option text>"},
    {"letter": "D", "text": "<option text>"}
  ]
}
If no questions found, return [].
Do NOT include any text before or after the JSON array.`
                    },
                    {
                        role: 'user',
                        content: `Extract questions from this exam text:\n\n${text}`
                    }
                ],
                max_tokens: 4000,
                temperature: 0
            });

            const content = response.choices[0].message.content.trim();
            // Extract JSON array even if there's surrounding text
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (!jsonMatch) return [];

            const parsed = JSON.parse(jsonMatch[0]);
            return parsed.map(q => ({
                id: uuidv4(),
                number: q.number || 0,
                text: q.text || '',
                options: (q.options || []).map(o => ({
                    letter: o.letter,
                    text: o.text
                })),
                correctAnswer: null,
                type: 'reading',
                imageUrl: null
            }));
        } catch (err) {
            console.error('AI text parsing error:', err.message);
            return [];
        }
    }

    // ─── AI Vision Parsing (for scanned/image PDFs) ───────────────────────────

    async parseWithVision(filePath, fileId, fileImagesDir, numPages) {
        // Check if pdftoppm is available
        const hasPdftoppm = await this.checkPdftoppm();
        if (!hasPdftoppm) {
            console.warn('pdftoppm not found — falling back to regex parser');
            return [];
        }

        // Convert PDF pages to images (limit to 20 pages max)
        const maxPages = Math.min(numPages, 20);
        const outputBase = path.join(fileImagesDir, 'page');

        try {
            console.log(`Converting ${maxPages} pages to images...`);
            await execAsync(
                `pdftoppm -r 150 -jpeg -jpegopt quality=80 -l ${maxPages} "${filePath}" "${outputBase}"`
            );
        } catch (err) {
            console.error('pdftoppm failed:', err.message);
            return [];
        }

        // Find generated image files
        const imageFiles = fs.readdirSync(fileImagesDir)
            .filter(f => f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.ppm'))
            .sort()
            .map(f => path.join(fileImagesDir, f));

        console.log(`Generated ${imageFiles.length} page images`);

        // Process images in batches of 4 pages
        const batchSize = 4;
        const allQuestions = [];

        for (let i = 0; i < imageFiles.length; i += batchSize) {
            const batch = imageFiles.slice(i, i + batchSize);
            console.log(`  OCR batch ${Math.floor(i / batchSize) + 1}: pages ${i + 1}-${i + batch.length}`);
            const questions = await this.extractQuestionsFromImages(batch);
            allQuestions.push(...questions);
        }

        // Cleanup images to save space
        try {
            imageFiles.forEach(f => fs.unlinkSync(f));
        } catch (_) { /* ignore cleanup errors */ }

        // Deduplicate by question number
        const seen = new Set();
        return allQuestions.filter(q => {
            if (seen.has(q.number)) return false;
            seen.add(q.number);
            return true;
        });
    }

    async extractQuestionsFromImages(imagePaths) {
        try {
            // Encode images as base64
            const imageContents = imagePaths.map(imgPath => {
                const imageData = fs.readFileSync(imgPath);
                const base64 = imageData.toString('base64');
                return {
                    type: 'image_url',
                    image_url: {
                        url: `data:image/jpeg;base64,${base64}`,
                        detail: 'high'
                    }
                };
            });

            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content: `You are an expert at parsing Vietnamese IOE (International Olympiad of English) exam papers from images.
Extract ALL multiple-choice questions visible in the images.
Return ONLY a valid JSON array:
[{
  "number": <integer>,
  "text": "<question text>",
  "options": [
    {"letter": "A", "text": "<option>"},
    {"letter": "B", "text": "<option>"},
    {"letter": "C", "text": "<option>"},
    {"letter": "D", "text": "<option>"}
  ]
}]
If no questions, return [].`
                    },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: 'Extract all questions and answer choices from these exam pages:' },
                            ...imageContents
                        ]
                    }
                ],
                max_tokens: 4000,
                temperature: 0
            });

            const content = response.choices[0].message.content.trim();
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (!jsonMatch) return [];

            const parsed = JSON.parse(jsonMatch[0]);
            return parsed.map(q => ({
                id: uuidv4(),
                number: q.number || 0,
                text: q.text || '',
                options: (q.options || []).map(o => ({
                    letter: o.letter,
                    text: o.text
                })),
                correctAnswer: null,
                type: 'reading',
                imageUrl: null
            }));
        } catch (err) {
            console.error('Vision OCR error:', err.message);
            return [];
        }
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
