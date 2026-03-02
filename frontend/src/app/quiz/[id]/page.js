'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import axios from 'axios';
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

  useEffect(() => {
    fetchQuiz();
  }, [params.id]);

  const fetchQuiz = async () => {
    try {
      const res = await axios.get(`${API_URL}/pdf/${params.id}`);
      setQuiz(res.data);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching quiz:', error);
      alert('Không thể tải đề thi');
    }
  };

  const handleAnswer = (questionId, answerIndex) => {
    setAnswers({ ...answers, [questionId]: answerIndex });
  };

  const getAIExplanation = async () => {
    const question = quiz.questions[currentIndex];
    const selectedAnswer = question.options[answers[question.id]];
    
    setSubmitting(true);
    try {
      const res = await axios.post(`${API_URL}/ai/explain`, {
        question,
        selectedAnswer,
        provider: 'openai'
      });
      setExplanation(res.data.explanation);
      setShowExplanation(true);
    } catch (error) {
      console.error('Error getting explanation:', error);
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

  const calculateScore = () => {
    let correct = 0;
    quiz.questions.forEach((q) => {
      if (answers[q.id] === q.correctAnswer) {
        correct++;
      }
    });
    return correct;
  };

  if (loading) {
    return <div className={styles.loading}>Đang tải đề thi...</div>;
  }

  if (!quiz) {
    return <div className={styles.error}>Không tìm thấy đề thi</div>;
  }

  const currentQuestion = quiz.questions[currentIndex];
  const isLastQuestion = currentIndex === quiz.questions.length - 1;
  const hasAnswered = answers[currentQuestion.id] !== undefined;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>{quiz.filename}</h1>
        <div className={styles.progress}>
          Câu {currentIndex + 1} / {quiz.questions.length}
        </div>
      </div>

      <div className={styles.progressBar}>
        <div 
          className={styles.progressFill}
          style={{ width: `${((currentIndex + 1) / quiz.questions.length) * 100}%` }}
        />
      </div>

      <div className={styles.questionCard}>
        {currentQuestion.imageUrl && (
          <img 
            src={currentQuestion.imageUrl} 
            alt="Question" 
            className={styles.questionImage}
          />
        )}
        
        <div className={styles.questionNumber}>Câu {currentIndex + 1}</div>
        <div className={styles.questionText}>{currentQuestion.text}</div>

        <div className={styles.options}>
          {currentQuestion.options.map((option, index) => (
            <div
              key={index}
              className={`${styles.option} ${answers[currentQuestion.id] === index ? styles.selected : ''}`}
              onClick={() => handleAnswer(currentQuestion.id, index)}
            >
              <span className={styles.optionLetter}>
                {String.fromCharCode(65 + index)}
              </span>
              <span className={styles.optionText}>{option.text}</span>
            </div>
          ))}
        </div>

        {showExplanation && explanation && (
          <div className={styles.explanation}>
            <h3>🤖 Giải thích AI</h3>
            <p>{explanation}</p>
          </div>
        )}
      </div>

      <div className={styles.actions}>
        <button 
          className={styles.btn} 
          onClick={prevQuestion}
          disabled={currentIndex === 0}
        >
          ← Trước
        </button>

        <button 
          className={styles.btnAI}
          onClick={getAIExplanation}
          disabled={!hasAnswered || submitting}
        >
          {submitting ? '...' : '🤖 Giải thích AI'}
        </button>

        {isLastQuestion ? (
          <button 
            className={styles.btnSubmit}
            onClick={() => {
              const score = calculateScore();
              alert(`Hoàn thành! Điểm: ${score}/${quiz.questions.length}`);
            }}
          >
            Nộp bài
          </button>
        ) : (
          <button 
            className={styles.btn}
            onClick={nextQuestion}
          >
            Sau →
          </button>
        )}
      </div>
    </div>
  );
}
