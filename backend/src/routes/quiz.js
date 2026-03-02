import express from 'express';

const router = express.Router();

// In-memory session storage
const sessions = new Map();

// Start a quiz session
router.post('/start', (req, res) => {
    const { quizId, userId } = req.body;
    
    if (!quizId) {
        return res.status(400).json({ error: 'quizId is required' });
    }
    
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    sessions.set(sessionId, {
        quizId,
        userId: userId || 'anonymous',
        answers: {},
        startedAt: new Date().toISOString(),
        completedAt: null
    });
    
    res.json({ sessionId, message: 'Quiz session started' });
});

// Submit answer for a question
router.post('/answer', (req, res) => {
    const { sessionId, questionId, answer } = req.body;
    
    if (!sessionId || !questionId) {
        return res.status(400).json({ error: 'sessionId and questionId are required' });
    }
    
    const session = sessions.get(sessionId);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }
    
    session.answers[questionId] = {
        answer,
        answeredAt: new Date().toISOString()
    };
    
    res.json({ success: true, message: 'Answer submitted' });
});

// Complete quiz and get results
router.post('/complete', (req, res) => {
    const { sessionId } = req.body;
    
    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
    }
    
    const session = sessions.get(sessionId);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }
    
    session.completedAt = new Date().toISOString();
    
    res.json({
        sessionId,
        answers: session.answers,
        completedAt: session.completedAt
    });
});

// Get session status
router.get('/session/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    
    const session = sessions.get(sessionId);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }
    
    res.json(session);
});

export default router;
