"use client";

import { useState, useEffect, Suspense } from "react";
import axios from "axios";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import styles from "./page.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

function HomeContent() {
  const [quizzes, setQuizzes] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [selectedSubject, setSelectedSubject] = useState("all");
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadGrade, setUploadGrade] = useState("2");
  const [uploadJob, setUploadJob] = useState(null); // { status, progress, total, message }
  const [toast, setToast] = useState(null); // { message, type: 'success'|'error' }
  const searchParams = useSearchParams();

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    // Check for auth callback
    if (searchParams.get("success") === "true") {
      window.history.replaceState({}, "", "/");
    }
    fetchData();
  }, [searchParams]);

  const fetchData = async () => {
    try {
      const [quizzesRes, subjectsRes, userRes] = await Promise.all([
        axios.get(`${API_URL}/pdf`, { withCredentials: true }),
        axios.get(`${API_URL}/pdf/meta/subjects`, { withCredentials: true }),
        axios.get(`${API_URL}/user`, { withCredentials: true }),
      ]);
      setQuizzes(quizzesRes.data);
      setSubjects(subjectsRes.data);
      setUser(userRes.data.user);
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = () => {
    window.location.href = `${API_URL}/auth/google`;
  };

  const handleLogout = async () => {
    try {
      await axios.get(`${API_URL}/auth/logout`, { withCredentials: true });
      setUser(null);
      window.location.href = "/";
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const handleFileUpload = async (file) => {
    if (!file || file.type !== "application/pdf") {
      alert("Vui lòng chọn file PDF");
      return;
    }

    if (!user || user.role !== "admin") {
      alert("Bạn cần đăng nhập với tài khoản admin để tải lên đề thi");
      return;
    }

    setUploading(true);
    setUploadJob({ status: 'processing', progress: 0, total: 100, message: 'Đang tải lên...' });

    const formData = new FormData();
    formData.append("pdf", file);
    formData.append("title", uploadTitle || file.name.replace(".pdf", ""));
    formData.append("grade", uploadGrade);

    try {
      const { data } = await axios.post(`${API_URL}/pdf/upload`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        withCredentials: true,
      });

      const { jobId } = data;

      // Poll for progress every 2 seconds
      const pollInterval = setInterval(async () => {
        try {
          const { data: job } = await axios.get(`${API_URL}/pdf/progress/${jobId}`, { withCredentials: true });
          setUploadJob(job);

          if (job.status === 'done') {
            clearInterval(pollInterval);
            setUploading(false);
            setUploadTitle('');
            setTimeout(() => setUploadJob(null), 3000);
            fetchData();
            showToast(`🎉 Tiêu xử lý thành công! Tìm thấy ${job.questionCount} câu hỏi`);
          } else if (job.status === 'error') {
            clearInterval(pollInterval);
            setUploading(false);
            setUploadJob(null);
            showToast('Lỗi xử lý PDF: ' + job.error, 'error');
          }
        } catch {
          // ignore poll errors
        }
      }, 2000);

    } catch (error) {
      setUploading(false);
      setUploadJob(null);
      alert('Lỗi tải lên: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const filteredQuizzes =
    selectedSubject === "all"
      ? quizzes
      : quizzes.filter((q) => q.subject === selectedSubject);

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Đang tải...</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Toast Notification */}
      {toast && (
        <div className={`${styles.toast} ${styles[`toast_${toast.type}`]}`}>
          {toast.message}
        </div>
      )}
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div>
            <h1>📚 Quiz Portal</h1>
            <p>Nền tảng luyện thi trực tuyến</p>
          </div>
          <div className={styles.authSection}>
            {user ? (
              <div className={styles.userInfo}>
                <img
                  src={user.avatar || "/default-avatar.png"}
                  alt={user.name}
                  className={styles.avatar}
                />
                <div className={styles.userDetails}>
                  <span className={styles.userName}>{user.name}</span>
                  {user.isAdmin && (
                    <span className={styles.adminBadge}>Admin</span>
                  )}
                </div>
                <button onClick={handleLogout} className={styles.logoutBtn}>
                  Đăng xuất
                </button>
              </div>
            ) : (
              <button onClick={handleLogin} className={styles.loginBtn}>
                🔐 Đăng nhập Google
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Upload Section - Admin Only */}
      {user && user.isAdmin && (
        <div className={styles.uploadSection}>
          {/* Progress Bar */}
          {uploadJob && (
            <div className={styles.progressBox}>
              <div className={styles.progressHeader}>
                <span className={styles.progressMsg}>{uploadJob.message}</span>
                <span className={styles.progressPct}>
                  {uploadJob.status === 'done' ? '✅' : `${uploadJob.progress || 0}%`}
                </span>
              </div>
              <div className={styles.progressTrack}>
                <div
                  className={`${styles.progressFill} ${uploadJob.status === 'done' ? styles.progressDone : ''}`}
                  style={{ width: `${uploadJob.progress || 0}%` }}
                />
              </div>
            </div>
          )}

          {/* Drop zone — hidden while processing */}
          {!uploading && (
            <>
              <div
                className={`${styles.uploadZone} ${dragActive ? styles.active : ''}`}
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onClick={() => document.getElementById('fileInput').click()}
              >
                <div className={styles.uploadIcon}>📄</div>
                <h3>Kéo thả file PDF vào đây</h3>
                <p>hoặc click để chọn file</p>
              </div>
              <input
                id="fileInput"
                type="file"
                accept="application/pdf"
                onChange={(e) => handleFileUpload(e.target.files[0])}
                style={{ display: 'none' }}
              />
              <div className={styles.uploadOptions}>
                <input
                  type="text"
                  placeholder="Tên đề thi (tùy chọn)"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  className={styles.input}
                />
                <select
                  value={uploadGrade}
                  onChange={(e) => setUploadGrade(e.target.value)}
                  className={styles.select}
                >
                  {[1,2,3,4,5,6,7,8,9,10,11,12].map(g => (
                    <option key={g} value={String(g)}>Lớp {g}</option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>
      )}

      {/* Subject Filters */}
      <section className={styles.filters}>
        <button
          className={`${styles.filterBtn} ${selectedSubject === "all" ? styles.active : ""}`}
          onClick={() => setSelectedSubject("all")}
        >
          📚 Tất cả
        </button>
        {subjects.map((subject) => (
          <button
            key={subject.id}
            className={`${styles.filterBtn} ${selectedSubject === subject.id ? styles.active : ""}`}
            onClick={() => setSelectedSubject(subject.id)}
            style={{
              "--subject-color": subject.color,
              borderColor:
                selectedSubject === subject.id ? subject.color : "transparent",
            }}
          >
            {subject.icon} {subject.name}
          </button>
        ))}
      </section>

      {/* Quiz List */}
      <section className={styles.quizList}>
        <h2>Danh sách đề thi ({filteredQuizzes.length})</h2>
        <div className={styles.grid}>
          {filteredQuizzes.map((quiz) => (
            <Link
              href={`/quiz/${quiz.id}`}
              key={quiz.id}
              className={styles.quizCard}
            >
              <div
                className={styles.quizIcon}
                style={{ background: quiz.subjectInfo?.color || "#4ECDC4" }}
              >
                {quiz.subjectInfo?.icon || "📝"}
              </div>
              <div className={styles.quizInfo}>
                <h3>{quiz.title || quiz.filename}</h3>
                <p>
                  {quiz.questionCount} câu hỏi • Lớp {quiz.grade}
                </p>
                <span className={styles.date}>
                  {new Date(quiz.uploadedAt).toLocaleDateString("vi-VN")}
                </span>
              </div>
              <div className={styles.startBtn}>Làm bài →</div>
            </Link>
          ))}
        </div>

        {filteredQuizzes.length === 0 && (
          <div className={styles.empty}>
            <p>Chưa có đề thi nào.</p>
            {user?.isAdmin && <p>Hãy tải lên file PDF để bắt đầu!</p>}
          </div>
        )}
      </section>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className={styles.loading}>Đang tải...</div>}>
      <HomeContent />
    </Suspense>
  );
}
