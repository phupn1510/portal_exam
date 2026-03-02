// PDF Parsing Service
import pdfplumber from 'pdfplumber';
import pytesseract from 'pytesseract';
import { fromBuffer } from 'pdf2pic';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

class PDFParser {
    constructor() {
        this.uploadDir = './uploads';
        this.imagesDir = './uploads/images';
    }

    async parsePDF(filePath, fileId) {
        const questions = [];
        
        try {
            // Get images directory for this file
            const fileImagesDir = path.join(this.imagesDir, fileId);
            if (!fs.existsSync(fileImagesDir)) {
                fs.mkdirSync(fileImagesDir, { recursive: true });
            }

            const pdf = await pdfplumber.open(filePath);
            console.log(`Processing PDF with ${pdf.pages.length} pages...`);

            for (let pageNum = 0; pageNum < pdf.pages.length; pageNum++) {
                const page = pdf.pages[pageNum];
                
                // Check if page has images (scanned PDF)
                const hasImages = page.images && page.images.length > 0;
                
                let text = '';
                let images = [];
                
                if (hasImages) {
                    // For scanned PDFs, use OCR
                    const pageImage = await this.extractPageAsImage(filePath, pageNum + 1, fileImagesDir);
                    if (pageImage) {
                        images.push(pageImage);
                        text = await this.performOCR(pageImage);
                    }
                } else {
                    // For digital PDFs, extract text directly
                    text = page.extract_text() || '';
                }

                // Parse questions from extracted text
                const pageQuestions = this.parseQuestionsFromText(text, pageNum + 1, images);
                questions.push(...pageQuestions);
            }

            await pdf.close();

            return {
                success: true,
                questionCount: questions.length,
                questions
            };

        } catch (error) {
            console.error('PDF parsing error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async extractPageAsImage(pdfPath, pageNum, outputDir) {
        try {
            const options = {
                density: 150,
                format: 'png',
                width: 1200,
                height: 1690,
                saveFilename: `page-${pageNum}`,
                savePath: outputDir
            };

            const convert = fromBuffer(fs.readFileSync(pdfPath), options);
            const imagePath = await convert(pageNum);
            return imagePath.path;
        } catch (error) {
            console.error('Image extraction error:', error);
            return null;
        }
    }

    async performOCR(imagePath) {
        try {
            const image = fs.readFileSync(imagePath);
            const text = pytesseract.image_to_string(image, lang='vie+eng');
            return text;
        } catch (error) {
            console.error('OCR error:', error);
            return '';
        }
    }

    parseQuestionsFromText(text, pageNum, images) {
        const questions = [];
        const lines = text.split('\n');
        
        // Question patterns to detect
        const questionPattern = /^(\d+)[\.\)]\s*(.+)/;
        
        let currentQuestion = null;
        
        for (const line of lines) {
            const trimmed = line.trim();
            const match = trimmed.match(questionPattern);
            
            if (match) {
                // Save previous question if exists
                if (currentQuestion) {
                    questions.push(currentQuestion);
                }
                
                // Start new question
                currentQuestion = {
                    id: uuidv4(),
                    number: parseInt(match[1]),
                    text: match[2].trim(),
                    options: [],
                    correctAnswer: null,
                    pageNumber: pageNum,
                    imageUrl: images.length > 0 ? images[0] : null,
                    type: this.detectQuestionType(match[2])
                };
            } else if (currentQuestion) {
                // Check for answer options (A, B, C, D)
                const optionMatch = trimmed.match(/^([A-D])[\.\)]\s*(.+)/i);
                if (optionMatch) {
                    currentQuestion.options.push({
                        letter: optionMatch[1].toUpperCase(),
                        text: optionMatch[2].trim()
                    });
                }
            }
        }
        
        // Don't forget the last question
        if (currentQuestion) {
            questions.push(currentQuestion);
        }
        
        return questions;
    }

    detectQuestionType(questionText) {
        const lowerText = questionText.toLowerCase();
        
        if (lowerText.includes('nghe') || lowerText.includes('listen')) {
            return 'listening';
        } else if (lowerText.includes('which') || lowerText.includes('sounds like')) {
            return 'phonics';
        } else if (lowerText.includes('anh') || lowerText.includes('picture')) {
            return 'image';
        } else {
            return 'reading';
        }
    }
}

export default new PDFParser();
