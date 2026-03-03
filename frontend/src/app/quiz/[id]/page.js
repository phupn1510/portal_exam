'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import axios from 'axios';
import Link from 'next/link';
import styles from './quiz.module.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

export default function QuizPage() {
  const params = useParams();
  const [quiz, setQuiz] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [showExplanation, setShowExplanation] = useState(false);
  const [explanation, setExplanation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [finished, setFinished] = useState(false);
  const [aiProvider, setAiProvider] = useState('openai');

  useEffect(() => { fetchQuiz(); }, [params.id]);

  const fetchQuiz = async () => {
    try {
      const res = await axios.get(`${API_URL}/pdf/${params.id}`);
      setQuiz(res.data);
      setLoading(false);
    } catch {
      alert('Không thể tải đề thi');
    }
  };

  const handleAnswer = (questionId, idx) => {
    if (finished) return;
    setAnswers({ ...answers, [questionId]: idx });
  };

  const getAIExplanation = async () => {
    const question = quiz.questions[currentIndex];
    if (question.type === 'listening') return;
    const selectedAnswer = question.options[answers[question.id]];
    setSubmitting(true);
    try {
      const res = await axios.post(`${API_URL}/ai/explain`, { question, selectedAnswer, provider: aiProvider });
      setExplanation(res.data.explanation);
      setShowExplanation(true);
    } catch {
      alert('Không thể lấy giải thích AI');
    } finally {
      setSubmitting(false);
    }
  };

  const nextQuestion = () => {
    if (currentIndex < quiz.questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setShowExplanation(false);
      setExplanation(null);
    }
  };

  const prevQuestion = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setShowExplanation(false);
      setExplanation(null);
    }
  };

  // Only scorable (non-listening) questions count
  const getScoreInfo = () => {
    const scorable = quiz.questions.filter(q => q.type !== 'listening');
    const listeningCount = quiz.questions.length - scorable.length;
    const correct = scorable.filter(q => answers[q.id] === q.correctAnswer).length;
    return { correct, total: scorable.length, listeningCount };
  };

  const handleSubmit = () => {
    setFinished(true);
  };

  if (loading) return <div className={styles.loading}>Đang tải đề thi...</div>;
  if (!quiz)   return <div className={styles.error}>Không tìm thấy đề thi</div>;

  const currentQuestion = quiz.questions[currentIndex];
  const isListening = currentQuestion.type === 'listening';
  const isLastQuestion = currentIndex === quiz.questions.length - 1;
  const hasAnswered = answers[currentQuestion.id] !== undefined;
  const { correct, total, listeningCount } = getScoreInfo();

  // ── Result screen ──────────────────────────────────────────────────────────
  if (finished) {
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    return (
      <div className={styles.container}>
        <div className={styles.resultCard}>
          <div className={styles.resultEmoji}>
            {pct >= 80 ? '🏆' : pct >= 50 ? '👍' : '📚'}
          </div>
          <h2>Kết quả</h2>
          <div className={styles.resultScore}>{correct} / {total}</div>
          <div className={styles.resultPct}>{pct}%</div>
          {listeningCount > 0 && (
            <p className={styles.resultNote}>
              🎧 {listeningCount} câu nghe không tính điểm
            </p>
          )}
          <div className={styles.resultBar}>
            <div className={styles.resultFill} style={{ width: `${pct}%` }} />
          </div>
          <Link href="/" className={styles.btn} style={{ textDecoration: 'none', marginTop: 24, display: 'inline-block' }}>
            ← Về trang chủ
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Link href="/" className={styles.backLink}>← Trang chủ</Link>
        <h1>{quiz.filename || quiz.title}</h1>
        <div className={styles.progress}>
          Câu {currentIndex + 1} / {quiz.questions.length}
          {listeningCount > 0 && <span className={styles.listeningCount}> · 🎧 {listeningCount} nghe</span>}
        </div>
      </div>

      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: `${((currentIndex + 1) / quiz.questions.length) * 100}%` }} />
      </div>

      {/* AI provider selector */}
      <div className={styles.providerRow}>
        <span>🤖 Giải thích bởi:</span>
        {['openai', 'kimi', 'gemini'].map(p => (
          <button key={p} className={`${styles.providerBtn} ${aiProvider === p ? styles.providerActive : ''}`} onClick={() => setAiProvider(p)}>
            {p === 'openai' ? 'GPT-4o' : p === 'kimi' ? 'Kimi K2' : 'Gemini'}
          </button>
        ))}
      </div>

      <div className={styles.questionCard}>
        {/* Listening badge */}
        {isListening && (
          <div className={styles.listeningBadge}>
            🎧 Câu nghe — <strong>không tính điểm</strong>
          </div>
        )}

        {currentQuestion.imageUrl && (
          <img src={currentQuestion.imageUrl} alt="Question" className={styles.questionImage} />
        )}

        <div className={styles.questionNumber}>Câu {currentIndex + 1}</div>
        <div className={styles.questionText}>{currentQuestion.text || '(Câu hỏi không có nội dung text — xem hình)'}</div>

        <div className={styles.options}>
          {currentQuestion.options.map((option, index) => (
            <div
              key={index}
              className={`${styles.option} ${answers[currentQuestion.id] === index ? styles.selected : ''} ${isListening ? styles.listeningOption : ''}`}
              onClick={() => handleAnswer(currentQuestion.id, index)}
            >
              <span className={styles.optionLetter}>{String.fromCharCode(65 + index)}</span>
              <span className={styles.optionText}>{option.text}</span>
            </div>
          ))}
        </div>

        {showExplanation && explanation && (
          <div className={styles.explanation}>
            <h3>🤖 Giải thích ({aiProvider})</h3>
            <p>{explanation}</p>
          </div>
        )}
      </div>

      <div className={styles.actions}>
        <button className={styles.btn} onClick={prevQuestion} disabled={currentIndex === 0}>← Trước</button>

        {!isListening && (
          <button className={styles.btnAI} onClick={getAIExplanation} disabled={!hasAnswered || submitting}>
            {submitting ? '...' : '🤖 Giải thích AI'}
          </button>
        )}

        {isLastQuestion ? (
          <button className={styles.btnSubmit} onClick={handleSubmit}>Nộp bài ✓</button>
        ) : (
          <button className={styles.btn} onClick={nextQuestion}>Sau →</button>
        )}
      </div>
    </div>
  );
}
