// PDF Parsing Service using pdf-parse
import pdf from 'pdf-parse';
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

            // Read and parse PDF
            const dataBuffer = fs.readFileSync(filePath);
            const pdfData = await pdf(dataBuffer);
            
            console.log(`Processing PDF with ${pdfData.numpages} pages...`);
            
            // Extract text from all pages
            const fullText = pdfData.text;
            
            // Parse questions from extracted text
            const extractedQuestions = this.parseQuestionsFromText(fullText, 1, []);
            
            return {
                success: true,
                questionCount: extractedQuestions.length,
                questions: extractedQuestions
            };

        } catch (error) {
            console.error('PDF parsing error:', error);
            return {
                success: false,
                error: error.message
            };
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
            if (!trimmed) continue;
            
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
                    imageUrl: null,
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
