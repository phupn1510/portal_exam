'use client';

import { useState, useEffect } from 'react';
import axios from 'axios';
import Link from 'next/link';
import styles from './page.module.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

export default function Home() {
  const [quizzes, setQuizzes] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    fetchQuizzes();
  }, []);

  const fetchQuizzes = async () => {
    try {
      const res = await axios.get(`${API_URL}/pdf`);
      setQuizzes(res.data);
    } catch (error) {
      console.error('Error fetching quizzes:', error);
    }
  };

  const handleFileUpload = async (file) => {
    if (!file || file.type !== 'application/pdf') {
      alert('Vui lòng chọn file PDF');
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('pdf', file);

    try {
      const res = await axios.post(`${API_URL}/pdf/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      alert('Tải lên thành công!');
      fetchQuizzes();
    } catch (error) {
      alert('Lỗi tải lên: ' + (error.response?.data?.error || error.message));
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = () => {
    setDragActive(false);
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>📚 IOE Quiz Portal</h1>
        <p>Nền tảng luyện thi tiếng Anh trực tuyến</p>
      </header>

      <div className={styles.uploadSection}>
        <div 
          className={`${styles.uploadZone} ${dragActive ? styles.active : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => document.getElementById('fileInput').click()}
        >
          {uploading ? (
            <div className={styles.spinner}></div>
          ) : (
            <>
              <div className={styles.uploadIcon}>📄</div>
              <h3>Kéo thả file PDF vào đây</h3>
              <p>hoặc click để chọn file</p>
              <span className={styles.hint}>Hỗ trợ file PDF có câu hỏi trắc nghiệm</span>
            </>
          )}
        </div>
        <input
          id="fileInput"
          type="file"
          accept="application/pdf"
          onChange={(e) => handleFileUpload(e.target.files[0])}
        />
      </div>

      <section className={styles.quizList}>
        <h2>Danh sách đề thi</h2>
        <div className={styles.grid}>
          {quizzes.map((quiz) => (
            <Link href={`/quiz/${quiz.id}`} key={quiz.id} className={styles.quizCard}>
              <div className={styles.quizIcon}>📝</div>
              <div className={styles.quizInfo}>
                <h3>{quiz.filename}</h3>
                <p>{quiz.questionCount} câu hỏi</p>
                <span className={styles.date}>
                  {new Date(quiz.uploadedAt).toLocaleDateString('vi-VN')}
                </span>
              </div>
              <div className={styles.startBtn}>Bắt đầu →</div>
            </Link>
          ))}
        </div>
        
        {quizzes.length === 0 && (
          <div className={styles.empty}>
            <p>Chưa có đề thi nào. Hãy tải lên file PDF để bắt đầu!</p>
          </div>
        )}
      </section>
    </div>
  );
}
