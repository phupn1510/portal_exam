'use client';

import { useState, useEffect } from 'react';
import axios from 'axios';
import Link from 'next/link';
import styles from './admin.module.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
const PROVIDERS = ['openai', 'kimi', 'gemini'];
const PROVIDER_LABELS = { openai: 'OpenAI (GPT-4o)', kimi: 'Kimi K2 (Moonshot)', gemini: 'Google Gemini' };

export default function AdminPage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [keyInputs, setKeyInputs] = useState({ openai: '', kimi: '', gemini: '' });
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState('');

  useEffect(() => { fetchSettings(); }, []);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchSettings = async () => {
    try {
      const { data } = await axios.get(`${API_URL}/admin/settings`, { withCredentials: true });
      setSettings(data);
    } catch (err) {
      if (err.response?.status === 403) {
        showToast('Chỉ owner mới truy cập được trang này', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const addEmail = async () => {
    if (!newEmail.includes('@')) return showToast('Email không hợp lệ', 'error');
    try {
      const { data } = await axios.post(`${API_URL}/admin/emails`, { email: newEmail }, { withCredentials: true });
      setSettings(s => ({ ...s, adminEmails: data.adminEmails }));
      setNewEmail('');
      showToast(`✅ Đã thêm ${newEmail}`);
    } catch (err) {
      showToast(err.response?.data?.error || 'Lỗi', 'error');
    }
  };

  const removeEmail = async (email) => {
    if (email === settings.ownerEmail) return;
    if (!confirm(`Xóa quyền admin của ${email}?`)) return;
    try {
      const { data } = await axios.delete(`${API_URL}/admin/emails/${encodeURIComponent(email)}`, { withCredentials: true });
      setSettings(s => ({ ...s, adminEmails: data.adminEmails }));
      showToast(`🗑️ Đã xóa ${email}`);
    } catch (err) {
      showToast(err.response?.data?.error || 'Lỗi', 'error');
    }
  };

  const saveKey = async (provider) => {
    const key = keyInputs[provider].trim();
    if (!key) return showToast('Nhập API key trước', 'error');
    setSaving(provider);
    try {
      await axios.post(`${API_URL}/admin/keys`, { provider, key }, { withCredentials: true });
      setKeyInputs(k => ({ ...k, [provider]: '' }));
      showToast(`✅ Đã lưu API key cho ${PROVIDER_LABELS[provider]}`);
      fetchSettings();
    } catch (err) {
      showToast(err.response?.data?.error || 'Lỗi', 'error');
    } finally {
      setSaving('');
    }
  };

  if (loading) return <div className={styles.loading}>Đang tải...</div>;
  if (!settings) return <div className={styles.error}>Không có quyền truy cập</div>;

  return (
    <div className={styles.container}>
      {toast && <div className={`${styles.toast} ${styles[`toast_${toast.type}`]}`}>{toast.msg}</div>}

      <header className={styles.header}>
        <Link href="/" className={styles.back}>← Trang chủ</Link>
        <h1>⚙️ Admin Settings</h1>
        <p>Owner: <strong>{settings.ownerEmail}</strong></p>
      </header>

      {/* Admin Emails */}
      <section className={styles.card}>
        <h2>👤 Danh sách Admin (có quyền upload)</h2>
        <ul className={styles.emailList}>
          {settings.adminEmails.map(email => (
            <li key={email} className={styles.emailItem}>
              <span>{email}</span>
              {email === settings.ownerEmail
                ? <span className={styles.ownerBadge}>👑 Owner</span>
                : <button className={styles.removeBtn} onClick={() => removeEmail(email)}>Xóa</button>
              }
            </li>
          ))}
        </ul>
        <div className={styles.addRow}>
          <input
            className={styles.input}
            placeholder="Thêm email admin mới..."
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addEmail()}
          />
          <button className={styles.addBtn} onClick={addEmail}>+ Thêm</button>
        </div>
      </section>

      {/* API Keys */}
      <section className={styles.card}>
        <h2>🔑 Cấu hình API Keys</h2>
        <p className={styles.hint}>Key hiện tại chỉ hiển thị 8 ký tự đầu. Nhập key mới để cập nhật.</p>
        {PROVIDERS.map(p => (
          <div key={p} className={styles.keyRow}>
            <div className={styles.keyLabel}>
              <strong>{PROVIDER_LABELS[p]}</strong>
              {settings.apiKeys[p]
                ? <span className={styles.keyStatus}>✅ {settings.apiKeys[p]}</span>
                : <span className={styles.keyMissing}>⚠️ Chưa cấu hình</span>
              }
            </div>
            <div className={styles.keyInput}>
              <input
                className={styles.input}
                type="password"
                placeholder={`Nhập ${p.toUpperCase()}_API_KEY mới...`}
                value={keyInputs[p]}
                onChange={e => setKeyInputs(k => ({ ...k, [p]: e.target.value }))}
              />
              <button
                className={styles.saveBtn}
                onClick={() => saveKey(p)}
                disabled={saving === p}
              >
                {saving === p ? '...' : 'Lưu'}
              </button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
