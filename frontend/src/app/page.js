"use client";

import { useState, useEffect, Suspense } from "react";
import axios from "axios";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import styles from "./page.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";
const GUEST_KEY = (name) => `guest_session_${name.toLowerCase().trim()}`;

function HomeContent() {
  const [quizzes, setQuizzes] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [selectedSubject, setSelectedSubject] = useState("all");
  const [selectedGrade, setSelectedGrade] = useState("all");
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadGrade, setUploadGrade] = useState("2");
  const [uploadTags, setUploadTags] = useState("");
  const [uploadTemplate, setUploadTemplate] = useState("generic");
  const [templates, setTemplates] = useState([]);
  const [showPrompt, setShowPrompt] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState("");
  const [uploadJob, setUploadJob] = useState(null);
  const [uploadJobId, setUploadJobId] = useState(null);
  const [pollRef, setPollRef] = useState(null);
  const [toast, setToast] = useState(null);
  // Guest session
  const [guestName, setGuestName] = useState("");
  const [guestSession, setGuestSession] = useState(null); // { name, scores }
  const [showGuestModal, setShowGuestModal] = useState(false);
  const [guestInput, setGuestInput] = useState("");
  const searchParams = useSearchParams();

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Guest session ────────────────────────────────────────────────────────────
  const loadGuestSession = (name) => {
    const stored = localStorage.getItem(GUEST_KEY(name));
    if (stored) {
      const session = JSON.parse(stored);
      setGuestSession(session);
      setGuestName(name);
      return session;
    }
    // Create new session
    const newSession = { name, scores: {}, createdAt: new Date().toISOString() };
    localStorage.setItem(GUEST_KEY(name), JSON.stringify(newSession));
    setGuestSession(newSession);
    setGuestName(name);
    return newSession;
  };

  const handleGuestEnter = () => {
    const name = guestInput.trim();
    if (!name || name.length < 2) return showToast("Nhập tên ít nhất 2 ký tự", "error");
    const session = loadGuestSession(name);
    setShowGuestModal(false);
    // Add name to URL for shareable sessions
    window.history.replaceState({}, "", `?name=${encodeURIComponent(name)}`);
    if (session.scores && Object.keys(session.scores).length > 0) {
      showToast(`👋 Chào ${name}! Tải lại phiên làm bài cũ.`);
    } else {
      showToast(`👋 Xin chào ${name}!`);
    }
  };

  useEffect(() => {
    if (searchParams.get("success") === "true") {
      window.history.replaceState({}, "", "/");
    }
    // Restore guest session from URL param
    const nameParam = searchParams.get("name");
    if (nameParam) {
      loadGuestSession(decodeURIComponent(nameParam));
    }
    fetchData();
  }, [searchParams]);

  const fetchData = async () => {
    try {
      const [quizzesRes, subjectsRes, userRes, templatesRes] = await Promise.all([
        axios.get(`${API_URL}/pdf`, { withCredentials: true }),
        axios.get(`${API_URL}/pdf/meta/subjects`, { withCredentials: true }),
        axios.get(`${API_URL}/user`, { withCredentials: true }),
        axios.get(`${API_URL}/pdf/meta/templates`, { withCredentials: true }).catch(() => ({ data: [] })),
      ]);
      setQuizzes(quizzesRes.data);
      setSubjects(subjectsRes.data);
      if (templatesRes.data?.length) setTemplates(templatesRes.data);
      const fetchedUser = userRes.data.user;
      setUser(fetchedUser);
      // Show guest modal only if not logged in and no guest name set
      if (!fetchedUser && !searchParams.get("name")) {
        setTimeout(() => setShowGuestModal(true), 600);
      }
    } catch {
      console.error("Error fetching data");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = () => { window.location.href = `${API_URL}/auth/google`; };

  const handleLogout = async () => {
    try {
      await axios.get(`${API_URL}/auth/logout`, { withCredentials: true });
      setUser(null);
      window.location.href = "/";
    } catch { console.error("Logout error"); }
  };

  const getTemplatePrompt = (id) => {
    const tpl = templates.find(t => t.id === id);
    return tpl?.promptText || "";
  };

  const handleTemplateChange = (id) => {
    setUploadTemplate(id);
    setEditedPrompt(getTemplatePrompt(id));
    setShowPrompt(false);
  };

  const handleFileUpload = async (file) => {
    if (!file || file.type !== "application/pdf") return showToast("Vui lòng chọn file PDF", "error");
    if (!user || user.role !== "admin") return showToast("Cần tài khoản admin để tải lên", "error");

    setUploading(true);
    setUploadJob({ status: "processing", progress: 0, total: 100, message: "Đang tải lên..." });

    const formData = new FormData();
    formData.append("pdf", file);
    formData.append("title", uploadTitle || file.name.replace(".pdf", ""));
    formData.append("grade", uploadGrade);
    formData.append("tags", uploadTags);
    if (uploadTemplate && uploadTemplate !== "generic") {
      formData.append("promptTemplate", uploadTemplate);
    }
    // Send edited prompt if user modified it
    const originalPrompt = getTemplatePrompt(uploadTemplate);
    if (editedPrompt && editedPrompt !== originalPrompt) {
      formData.append("customPrompt", editedPrompt);
    }

    try {
      const { data } = await axios.post(`${API_URL}/pdf/upload`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        withCredentials: true,
      });
      const { jobId } = data;
      setUploadJobId(jobId);

      const pollInterval = setInterval(async () => {
        try {
          const { data: job } = await axios.get(`${API_URL}/pdf/progress/${jobId}`, { withCredentials: true });
          setUploadJob(job);
          if (job.status === "done") {
            clearInterval(pollInterval);
            setPollRef(null); setUploadJobId(null);
            setUploading(false);
            setUploadTitle(""); setUploadTags("");
            setTimeout(() => setUploadJob(null), 3000);
            fetchData();
            showToast(`Thành công! ${job.questionCount} câu hỏi`);
          } else if (job.status === "error") {
            clearInterval(pollInterval);
            setPollRef(null); setUploadJobId(null);
            setUploading(false); setUploadJob(null);
            showToast("Lỗi xử lý PDF: " + job.error, "error");
          } else if (job.status === "stopped") {
            clearInterval(pollInterval);
            setPollRef(null); setUploadJobId(null);
            setUploading(false);
            showToast(`Đã dừng. ${job.questionCount || 0} câu hỏi đã trích xuất`, "error");
            setTimeout(() => setUploadJob(null), 3000);
          }
        } catch { /* ignore */ }
      }, 1500);
      setPollRef(pollInterval);

    } catch (error) {
      setUploading(false); setUploadJob(null);
      const msg = error.response?.data?.message || error.response?.data?.error || error.message;
      if (error.response?.status === 409) {
        showToast("⚠️ " + msg, "error");
      } else {
        showToast("Lỗi tải lên: " + msg, "error");
      }
    }
  };

  const handleStopUpload = async () => {
    if (!uploadJobId) return;
    try {
      await axios.post(`${API_URL}/pdf/stop/${uploadJobId}`, {}, { withCredentials: true });
      showToast("Đang dừng xử lý...");
    } catch (err) {
      showToast("Không thể dừng: " + (err.response?.data?.error || err.message), "error");
    }
  };

  const handleDeleteQuiz = async (e, quizId) => {
    e.preventDefault(); e.stopPropagation();
    if (!confirm("Xóa đề thi này?")) return;
    try {
      await axios.delete(`${API_URL}/pdf/${quizId}`, { withCredentials: true });
      setQuizzes(q => q.filter(quiz => quiz.id !== quizId));
      showToast("🗑️ Đã xóa đề thi");
    } catch (err) {
      showToast("Lỗi xóa: " + (err.response?.data?.error || err.message), "error");
    }
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDragActive(false);
    if (e.dataTransfer.files?.[0]) handleFileUpload(e.dataTransfer.files[0]);
  };

  const filteredQuizzes = quizzes
    .filter(q => selectedSubject === "all" || q.subject === selectedSubject)
    .filter(q => selectedGrade === "all" || q.grade === selectedGrade);

  if (loading) return <div className={styles.container}><div className={styles.loading}>Đang tải...</div></div>;

  return (
    <div className={styles.container}>
      {/* Toast */}
      {toast && <div className={`${styles.toast} ${styles[`toast_${toast.type}`]}`}>{toast.message}</div>}

      {/* Guest modal */}
      {showGuestModal && !user && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h2>👋 Xin chào!</h2>
            <p>Nhập tên của bạn để bắt đầu luyện thi. Phiên làm bài sẽ được lưu theo tên.</p>
            <input
              className={styles.input}
              placeholder="Tên của bạn..."
              value={guestInput}
              onChange={e => setGuestInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleGuestEnter()}
              autoFocus
            />
            <div className={styles.modalBtns}>
              <button className={styles.modalPrimary} onClick={handleGuestEnter}>Bắt đầu →</button>
              <button className={styles.modalSecondary} onClick={() => setShowGuestModal(false)}>Bỏ qua</button>
            </div>
            <p className={styles.modalHint}>Hoặc <button className={styles.linkBtn} onClick={handleLogin}>đăng nhập Google</button> để lưu kết quả đầy đủ hơn.</p>
          </div>
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
                <img src={user.avatar || "/default-avatar.png"} alt={user.name} className={styles.avatar} />
                <div className={styles.userDetails}>
                  <span className={styles.userName}>{user.name}</span>
                  {user.isAdmin && <span className={styles.adminBadge}>Admin</span>}
                </div>
                {user.email === "phupn1510@gmail.com" && (
                  <Link href="/admin" className={styles.adminLink}>⚙️ Admin</Link>
                )}
                <button onClick={handleLogout} className={styles.logoutBtn}>Đăng xuất</button>
              </div>
            ) : guestName ? (
              <div className={styles.guestInfo}>
                <span>👤 {guestName}</span>
                <button className={styles.loginBtn} onClick={handleLogin}>🔐 Đăng nhập</button>
              </div>
            ) : (
              <button onClick={() => setShowGuestModal(true)} className={styles.loginBtn}>Bắt đầu →</button>
            )}
          </div>
        </div>
      </header>

      {/* Upload Section - Admin Only */}
      {user?.isAdmin && (
        <div className={styles.uploadSection}>
          {uploadJob && (
            <div className={styles.progressBox}>
              <div className={styles.progressHeader}>
                <span className={styles.progressMsg}>{uploadJob.message}</span>
                <span className={styles.progressPct}>
                  {uploadJob.status === "done" ? "Done" : uploadJob.status === "stopped" ? "Stopped" : `${uploadJob.progress || 0}%`}
                </span>
              </div>
              <div className={styles.progressTrack}>
                <div className={`${styles.progressFill} ${uploadJob.status === "done" ? styles.progressDone : uploadJob.status === "stopped" ? styles.progressStopped : ""}`} style={{ width: `${uploadJob.progress || 0}%` }} />
              </div>
              {/* Batch details */}
              {uploadJob.batches && uploadJob.batches.length > 0 && (
                <div className={styles.batchList}>
                  {uploadJob.batches.map((b, idx) => (
                    <span key={idx} className={styles.batchItem}>
                      B{b.batch}: +{b.questionCount}
                    </span>
                  ))}
                  <span className={styles.batchTotal}>Tổng: {uploadJob.questionCount || 0} câu</span>
                </div>
              )}
              {/* Stop button */}
              {uploading && uploadJob.status === "processing" && (
                <button className={styles.stopBtn} onClick={handleStopUpload}>
                  Dừng xử lý
                </button>
              )}
            </div>
          )}
          {!uploading && (
            <>
              <div
                className={`${styles.uploadZone} ${dragActive ? styles.active : ""}`}
                onDrop={handleDrop}
                onDragOver={e => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onClick={() => document.getElementById("fileInput").click()}
              >
                <div className={styles.uploadIcon}>📄</div>
                <h3>Kéo thả file PDF vào đây</h3>
                <p>hoặc click để chọn file</p>
              </div>
              <input id="fileInput" type="file" accept="application/pdf" onChange={e => handleFileUpload(e.target.files[0])} style={{ display: "none" }} />
              <div className={styles.uploadOptions}>
                <input type="text" placeholder="Tên đề thi (tùy chọn)" value={uploadTitle} onChange={e => setUploadTitle(e.target.value)} className={styles.input} />
                <input type="text" placeholder="Tags: ioe, lớp2, anh..." value={uploadTags} onChange={e => setUploadTags(e.target.value)} className={styles.input} />
                <select value={uploadGrade} onChange={e => setUploadGrade(e.target.value)} className={styles.select}>
                  {[1,2,3,4,5,6,7,8,9,10,11,12].map(g => <option key={g} value={String(g)}>Lớp {g}</option>)}
                </select>
                <select value={uploadTemplate} onChange={e => handleTemplateChange(e.target.value)} className={styles.select} title="Chọn prompt template cho OCR">
                  {templates.length > 0 ? templates.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  )) : (
                    <>
                      <option value="generic">Tự động (Generic)</option>
                      <option value="ioe_english">IOE English</option>
                      <option value="vioedu_answer">VIOEDU Đáp án</option>
                    </>
                  )}
                </select>
                <button type="button" onClick={() => { if (!showPrompt) setEditedPrompt(getTemplatePrompt(uploadTemplate)); setShowPrompt(!showPrompt); }} className={styles.select} style={{ cursor: "pointer", background: showPrompt ? "#e0e7ff" : "#fff" }}>
                  {showPrompt ? "Ẩn prompt" : "Xem/Sửa prompt"}
                </button>
              </div>
              {showPrompt && (
                <div style={{ marginTop: 8 }}>
                  <textarea
                    value={editedPrompt}
                    onChange={e => setEditedPrompt(e.target.value)}
                    style={{ width: "100%", minHeight: 200, fontFamily: "monospace", fontSize: 12, padding: 10, borderRadius: 8, border: "1px solid #d1d5db", resize: "vertical" }}
                    placeholder="Prompt OCR sẽ gửi tới AI..."
                  />
                  {editedPrompt !== getTemplatePrompt(uploadTemplate) && (
                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      <span style={{ color: "#f59e0b", fontSize: 12 }}>Prompt đã được chỉnh sửa</span>
                      <button type="button" onClick={() => setEditedPrompt(getTemplatePrompt(uploadTemplate))} style={{ fontSize: 12, color: "#6366f1", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                        Reset về mặc định
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Subject Filters */}
      <section className={styles.filters}>
        <button className={`${styles.filterBtn} ${selectedSubject === "all" ? styles.active : ""}`} onClick={() => setSelectedSubject("all")}>📚 Tất cả môn</button>
        {subjects.map(s => (
          <button key={s.id} className={`${styles.filterBtn} ${selectedSubject === s.id ? styles.active : ""}`} onClick={() => setSelectedSubject(s.id)}>{s.icon} {s.name}</button>
        ))}
      </section>

      {/* Grade Filters */}
      <section className={styles.gradeFilters}>
        <button className={`${styles.gradeBtn} ${selectedGrade === "all" ? styles.gradeActive : ""}`} onClick={() => setSelectedGrade("all")}>Tất cả lớp</button>
        {[1,2,3,4,5,6,7,8,9,10,11,12].map(g => (
          <button key={g} className={`${styles.gradeBtn} ${selectedGrade === String(g) ? styles.gradeActive : ""}`} onClick={() => setSelectedGrade(String(g))}>Lớp {g}</button>
        ))}
      </section>

      {/* Quiz List */}
      <section className={styles.quizList}>
        <h2>Danh sách đề thi ({filteredQuizzes.length})</h2>
        <div className={styles.grid}>
          {filteredQuizzes.map(quiz => (
            <div key={quiz.id} className={styles.quizCardWrapper}>
              <Link href={`/quiz/${quiz.id}`} className={styles.quizCard}>
                <div className={styles.quizIcon} style={{ background: quiz.subjectInfo?.color || "#4ECDC4" }}>
                  {quiz.subjectInfo?.icon || "📝"}
                </div>
                <div className={styles.quizInfo}>
                  <h3>{quiz.title || quiz.filename}</h3>
                  {quiz.tags?.length > 0 && (
                    <div className={styles.tagRow}>
                      {quiz.tags.map(t => <span key={t} className={styles.tag}>{t}</span>)}
                    </div>
                  )}
                  <div className={styles.metaRow}>
                    <span className={styles.gradePill}>Lớp {quiz.grade || '?'}</span>
                    <span className={styles.date}>{new Date(quiz.uploadedAt).toLocaleDateString("vi-VN")}</span>
                  </div>
                </div>
                <div className={styles.startBtn}>Làm bài →</div>
              </Link>
              {user?.isAdmin && (
                <button className={styles.deleteBtn} onClick={e => handleDeleteQuiz(e, quiz.id)} title="Xóa đề thi">🗑️</button>
              )}
            </div>
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
