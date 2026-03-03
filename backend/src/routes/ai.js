import express from 'express';
import aiService from '../services/aiService.js';

const router = express.Router();

// Get AI explanation for a question
router.post('/explain', async (req, res) => {
    try {
        const { question, selectedAnswer, provider } = req.body;
        if (!question) return res.status(400).json({ error: 'question is required' });

        // Use explicitly passed provider, or fall back to admin-configured default
        const resolvedProvider = provider || await aiService.resolveAnswerProvider();
        const result = await aiService.explainAnswer(question, selectedAnswer, resolvedProvider);
        res.json(result);
    } catch (error) {
        console.error('AI explain error:', error);
        res.status(500).json({ error: error.message });
    }
});


// Get batch explanations
router.post('/explain-batch', async (req, res) => {
    try {
        const { questions, selectedAnswers, provider } = req.body;
        
        if (!questions || !Array.isArray(questions)) {
            return res.status(400).json({ error: 'questions array is required' });
        }
        
        const results = await aiService.explainBatch(
            questions, 
            selectedAnswers, 
            provider || 'openai'
        );
        
        res.json({ explanations: results });
        
    } catch (error) {
        console.error('AI batch explain error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Check available AI providers
router.get('/providers', (req, res) => {
    const providers = [
        { 
            id: 'openai', 
            name: 'OpenAI GPT', 
            configured: !!process.env.OPENAI_API_KEY 
        },
        { 
            id: 'gemini', 
            name: 'Google Gemini', 
            configured: !!process.env.GEMINI_API_KEY 
        },
        { 
            id: 'opencode', 
            name: 'OpenCode AI', 
            configured: false,
            note: 'Coming soon'
        }
    ];
    
    res.json(providers);
});

export default router;
