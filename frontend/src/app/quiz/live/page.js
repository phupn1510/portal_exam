'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import axios from 'axios';
import Link from 'next/link';
import styles from '../[id]/quiz.module.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

function LiveQuizContent() {
  const searchParams = useSearchParams();
  const jobId = searchParams.get('jobId');

  const [quiz, setQuiz] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [showExplanation, setShowExplanation] = useState(false);
  const [explanation, setExplanation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [finished, setFinished] = useState(false);
  const [aiProvider, setAiProvider] = useState('alibaba');
  const [fillInput, setFillInput] = useState('');
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!jobId) { setError('Missing jobId'); setLoading(false); return; }
    fetchQuiz();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobId]);

  const fetchQuiz = async () => {
    try {
      const { data } = await axios.get(`${API_URL}/pdf/jobs/${jobId}/quiz`);
      setQuiz(data);
      setLoading(false);

      // If still processing, poll for new questions
      if (data.isLive) {
        pollRef.current = setInterval(async () => {
          try {
            const { data: updated } = await axios.get(`${API_URL}/pdf/jobs/${jobId}/quiz`);
            setQuiz(prev => ({
              ...updated,
              // Keep existing quiz state but update questions
            }));
            if (!updated.isLive) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
          } catch { /* ignore poll errors */ }
        }, 5000);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load quiz');
      setLoading(false);
    }
  };

  // ── Answer handlers ──────────────────────────────────────────────────────
  const handleMCQAnswer = (questionId, letter) => {
    if (finished) return;
    setAnswers(prev => ({ ...prev, [questionId]: letter }));
  };

  const handleFillAnswer = (questionId) => {
    if (finished || !fillInput.trim()) return;
    setAnswers(prev => ({ ...prev, [questionId]: fillInput.trim() }));
  };

  // Auto-fetch AI explanation
  useEffect(() => {
    if (!quiz) return;
    const q = quiz.questions[currentIndex];
    if (!q || q.type === 'listening') return;
    if (answers[q.id] === undefined) return;
    autoExplain(q);
  }, [answers, currentIndex]);

  const autoExplain = async (question) => {
    const selectedAnswer = question.options?.length > 0
      ? question.options.find(o => o.letter === answers[question.id])
      : { letter: '-', text: answers[question.id] };
    if (!selectedAnswer) return;
    setSubmitting(true);
    try {
      const res = await axios.post(`${API_URL}/ai/explain`, { question, selectedAnswer, provider: aiProvider });
      setExplanation(res.data.explanation);
      setShowExplanation(true);
    } catch { /* silent */ }
    finally { setSubmitting(false); }
  };

  const getAIExplanation = async () => {
    const question = quiz.questions[currentIndex];
    if (question.type === 'listening') return;
    const selectedAnswer = question.options?.length > 0
      ? question.options.find(o => o.letter === answers[question.id])
      : { letter: '-', text: answers[question.id] };
    setSubmitting(true);
    try {
      const res = await axios.post(`${API_URL}/ai/explain`, { question, selectedAnswer, provider: aiProvider });
      setExplanation(res.data.explanation);
      setShowExplanation(true);
    } catch { alert('Không thể lấy giải thích AI'); }
    finally { setSubmitting(false); }
  };

  const nextQuestion = () => {
    if (currentIndex < quiz.questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setShowExplanation(false); setExplanation(null); setFillInput('');
    }
  };

  const prevQuestion = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setShowExplanation(false); setExplanation(null); setFillInput('');
    }
  };

  const getScoreInfo = () => {
    const scorable = quiz.questions.filter(q => q.type !== 'listening');
    const listeningCount = quiz.questions.length - scorable.length;
    const correct = scorable.filter(q => {
      const ans = answers[q.id];
      if (ans === undefined) return false;
      const ca = (q.correctAnswer || '').trim().toUpperCase();
      const ua = (typeof ans === 'string' ? ans : '').trim().toUpperCase();
      return ua === ca;
    }).length;
    return { correct, total: scorable.length, listeningCount };
  };

  const handleSubmit = () => { setFinished(true); };

  if (loading) return <div className={styles.loading}>Đang tải...</div>;
  if (error) return <div className={styles.error}>{error}</div>;
  if (!quiz || !quiz.questions?.length) return <div className={styles.error}>Chưa có câu hỏi nào</div>;

  const currentQuestion = quiz.questions[currentIndex];
  const isMCQ = currentQuestion.options && currentQuestion.options.length > 0;
  const isFillBlank = !isMCQ && currentQuestion.type !== 'listening';
  const isListening = currentQuestion.type === 'listening';
  const isLastQuestion = currentIndex === quiz.questions.length - 1;
  const hasAnswered = answers[currentQuestion.id] !== undefined;
  const { correct, total, listeningCount } = getScoreInfo();

  if (finished) {
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    return (
      <div className={styles.container}>
        <div className={styles.resultCard}>
          <div className={styles.resultEmoji}>{pct >= 80 ? '🏆' : pct >= 50 ? '👍' : '📚'}</div>
          <h2>Kết quả</h2>
          <div className={styles.resultScore}>{correct} / {total}</div>
          <div className={styles.resultPct}>{pct}%</div>
          {listeningCount > 0 && <p className={styles.resultNote}>🎧 {listeningCount} câu nghe không tính điểm</p>}
          <div className={styles.resultBar}><div className={styles.resultFill} style={{ width: `${pct}%` }} /></div>
          <Link href="/" className={styles.btn} style={{ textDecoration: 'none', marginTop: 24, display: 'inline-block' }}>← Về trang chủ</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Link href="/" className={styles.backLink}>← Trang chủ</Link>
        <h1>
          {quiz.title}
          {quiz.isLive && <span style={{ fontSize: '0.7em', marginLeft: 8, color: '#f39c12' }}>LIVE ({quiz.questionCount} câu)</span>}
        </h1>
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
        {['alibaba', 'openai', 'kimi', 'gemini'].map(p => (
          <button key={p} className={`${styles.providerBtn} ${aiProvider === p ? styles.providerActive : ''}`} onClick={() => setAiProvider(p)}>
            {p === 'alibaba' ? 'Qwen' : p === 'openai' ? 'GPT-4o' : p === 'kimi' ? 'Kimi K2' : 'Gemini'}
          </button>
        ))}
      </div>

      <div className={styles.questionCard}>
        {isListening && (
          <div className={styles.listeningBadge}>🎧 Câu nghe — <strong>không tính điểm</strong></div>
        )}
        {isMCQ && <div className={styles.typeBadge}>📝 Trắc nghiệm</div>}
        {isFillBlank && <div className={styles.typeBadge}>✏️ Điền đáp án</div>}

        {currentQuestion.imageUrl && (
          <img src={currentQuestion.imageUrl.startsWith('/') ? `${API_URL.replace('/api', '')}${currentQuestion.imageUrl}` : currentQuestion.imageUrl} alt="Question" className={styles.questionImage} />
        )}

        <div className={styles.questionNumber}>Câu {currentIndex + 1}</div>
        <div className={styles.questionText}>{currentQuestion.text || '(Câu hỏi không có nội dung text — xem hình)'}</div>

        {/* MCQ */}
        {isMCQ && (
          <div className={styles.options}>
            {currentQuestion.options.map((option, index) => {
              const letter = option.letter || String.fromCharCode(65 + index);
              const isSelected = answers[currentQuestion.id] === letter;
              const isCorrect = finished && letter === (currentQuestion.correctAnswer || '').toUpperCase();
              const isWrong = finished && isSelected && !isCorrect;
              return (
                <div key={index} className={`${styles.option} ${isSelected ? styles.selected : ''} ${isCorrect ? styles.correctOption : ''} ${isWrong ? styles.wrongOption : ''}`}
                  onClick={() => handleMCQAnswer(currentQuestion.id, letter)}>
                  <span className={styles.optionLetter}>{letter}</span>
                  <span className={styles.optionText}>{option.text}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Fill-blank */}
        {isFillBlank && (
          <div className={styles.fillBlank}>
            {answers[currentQuestion.id] !== undefined ? (
              <div className={styles.fillAnswer}>
                Đáp án của bạn: <strong>{answers[currentQuestion.id]}</strong>
                {finished && currentQuestion.correctAnswer && (
                  <span className={answers[currentQuestion.id].toUpperCase() === (currentQuestion.correctAnswer || '').toUpperCase() ? styles.correctText : styles.wrongText}>
                    {answers[currentQuestion.id].toUpperCase() === (currentQuestion.correctAnswer || '').toUpperCase() ? ' ✓ Đúng' : ` ✗ Đáp án: ${currentQuestion.correctAnswer}`}
                  </span>
                )}
              </div>
            ) : (
              <div className={styles.fillInputRow}>
                <input type="text" className={styles.fillInput} placeholder="Nhập đáp án..."
                  value={fillInput} onChange={e => setFillInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleFillAnswer(currentQuestion.id)} />
                <button className={styles.fillSubmitBtn} onClick={() => handleFillAnswer(currentQuestion.id)} disabled={!fillInput.trim()}>
                  Xác nhận
                </button>
              </div>
            )}
          </div>
        )}

        {finished && isMCQ && currentQuestion.correctAnswer && (
          <div className={styles.correctAnswerInfo}>Đáp án đúng: <strong>{currentQuestion.correctAnswer}</strong></div>
        )}

        {submitting && <div className={styles.explanationLoading}>🤖 Đang phân tích...</div>}

        {showExplanation && explanation && (
          <div className={styles.explanation}>
            <h3>🤖 Giải thích ({aiProvider})</h3>
            <p>{explanation}</p>
          </div>
        )}
      </div>

      <div className={styles.actions}>
        <button className={styles.btn} onClick={prevQuestion} disabled={currentIndex === 0}>← Trước</button>
        {!isListening && hasAnswered && !showExplanation && !submitting && (
          <button className={styles.btnAI} onClick={getAIExplanation}>🤖 Giải thích AI</button>
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

export default function LiveQuizPage() {
  return (
    <Suspense fallback={<div className={styles.loading}>Đang tải...</div>}>
      <LiveQuizContent />
    </Suspense>
  );
}
