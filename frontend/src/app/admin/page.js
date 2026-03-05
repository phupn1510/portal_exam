'use client';

import { useState, useEffect } from 'react';
import axios from 'axios';
import Link from 'next/link';
import styles from './admin.module.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

const PROVIDERS = ['openai', 'kimi', 'alibaba', 'gemini'];
const PROVIDER_LABELS = {
  openai:  'OpenAI (GPT)',
  kimi:    'Kimi K2 (Moonshot)',
  alibaba: 'Alibaba (Qwen)',
  gemini:  'Google Gemini',
};

const OCR_OPTIONS = [
  { value: 'auto',    label: '🤖 Auto' },
  { value: 'openai',  label: '🟢 OpenAI' },
  { value: 'alibaba', label: '🟠 Alibaba Qwen' },
  { value: 'kimi',    label: '🔵 Kimi K2 (text only)' },
];

const ANALYZE_OPTIONS = [
  { value: 'auto',    label: '🤖 Auto' },
  { value: 'openai',  label: '🟢 OpenAI' },
  { value: 'alibaba', label: '🟠 Alibaba Qwen' },
  { value: 'gemini',  label: '🟣 Gemini' },
  { value: 'kimi',    label: '🔵 Kimi K2' },
];

const ANSWER_OPTIONS = [
  { value: 'auto',    label: '🤖 Auto' },
  { value: 'openai',  label: '🟢 OpenAI' },
  { value: 'alibaba', label: '🟠 Alibaba Qwen' },
  { value: 'kimi',    label: '🔵 Kimi K2' },
  { value: 'gemini',  label: '🟣 Gemini' },
];

function ProviderRadio({ options, value, onChange, name }) {
  return (
    <div className={styles.ocrRow}>
      {options.map(o => (
        <label key={o.value} className={`${styles.ocrOption} ${value === o.value ? styles.ocrActive : ''}`}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function ModelInput({ label, step, value, onChange, onSave, saving, defaultModel }) {
  return (
    <div className={styles.modelRow}>
      <div className={styles.modelLabel}>
        <strong>{label}</strong>
        <span className={styles.modelDefault}>mặc định: <code>{defaultModel || '—'}</code></span>
      </div>
      <div className={styles.modelInputRow}>
        <input
          className={styles.input}
          placeholder={defaultModel || 'model name...'}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
        <button className={styles.saveBtn} onClick={() => onSave(step, value)} disabled={saving === step}>
          {saving === step ? '...' : 'Lưu'}
        </button>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [keyInputs, setKeyInputs] = useState({ openai: '', kimi: '', alibaba: '', gemini: '' });
  const [providers, setProviders] = useState({ ocr: 'auto', analyze: 'auto', answer: 'auto' });
  const [models, setModels] = useState({ ocr_text: '', ocr_vision: '', analyze: '', answer: '' });
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState('');
  const [ocrPrompt, setOcrPrompt] = useState('');

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => { fetchSettings(); }, []);

  const fetchSettings = async () => {
    try {
      const { data } = await axios.get(`${API_URL}/admin/settings`, { withCredentials: true });
      setSettings(data);
      setProviders({ ocr: data.ocrProvider || 'auto', analyze: data.analyzeProvider || 'auto', answer: data.answerProvider || 'auto' });
      setModels({
        ocr_text: data.models?.ocr_text || '',
        ocr_vision: data.models?.ocr_vision || '',
        analyze: data.models?.analyze || '',
        answer: data.models?.answer || '',
      });
      setOcrPrompt(data.ocrTextPrompt || '');
    } catch (err) {
      if (err.response?.status === 403) showToast('Chỉ owner mới truy cập được trang này', 'error');
    } finally { setLoading(false); }
  };

  const addEmail = async () => {
    if (!newEmail.includes('@')) return showToast('Email không hợp lệ', 'error');
    try {
      const { data } = await axios.post(`${API_URL}/admin/emails`, { email: newEmail }, { withCredentials: true });
      setSettings(s => ({ ...s, adminEmails: data.adminEmails }));
      setNewEmail(''); showToast(`Đã thêm ${newEmail}`);
    } catch (err) { showToast(err.response?.data?.error || 'Lỗi', 'error'); }
  };

  const removeEmail = async (email) => {
    if (email === settings.ownerEmail) return;
    if (!confirm(`Xóa quyền admin của ${email}?`)) return;
    try {
      const { data } = await axios.delete(`${API_URL}/admin/emails/${encodeURIComponent(email)}`, { withCredentials: true });
      setSettings(s => ({ ...s, adminEmails: data.adminEmails }));
      showToast(`Đã xóa ${email}`);
    } catch (err) { showToast(err.response?.data?.error || 'Lỗi', 'error'); }
  };

  const saveKey = async (provider) => {
    const key = keyInputs[provider].trim();
    if (!key) return showToast('Nhập API key trước', 'error');
    setSaving(provider);
    try {
      await axios.post(`${API_URL}/admin/keys`, { provider, key }, { withCredentials: true });
      setKeyInputs(k => ({ ...k, [provider]: '' }));
      showToast(`Đã lưu API key cho ${PROVIDER_LABELS[provider]}`);
      fetchSettings();
    } catch (err) { showToast(err.response?.data?.error || 'Lỗi', 'error'); }
    finally { setSaving(''); }
  };

  const saveOcrPrompt = async () => {
    setSaving('ocrPrompt');
    try {
      await axios.post(`${API_URL}/admin/ocr-prompt`, { prompt: ocrPrompt }, { withCredentials: true });
      showToast(ocrPrompt.trim() ? 'Đã lưu prompt tùy chỉnh' : 'Đã reset về prompt mặc định');
    } catch (err) { showToast(err.response?.data?.error || 'Lỗi', 'error'); }
    finally { setSaving(''); }
  };

  const saveProviderSetting = async (type, value) => {
    setSaving(type);
    const endpoint = { ocr: 'ocr-provider', analyze: 'analyze-provider', answer: 'answer-provider' }[type];
    const body = { provider: value };
    try {
      await axios.post(`${API_URL}/admin/${endpoint}`, body, { withCredentials: true });
      showToast(`${type} provider → ${value}`);
    } catch (err) { showToast(err.response?.data?.error || 'Lỗi', 'error'); }
    finally { setSaving(''); }
  };

  const saveModel = async (step, model) => {
    setSaving(step);
    try {
      await axios.post(`${API_URL}/admin/models`, { step, model }, { withCredentials: true });
      showToast(`Model ${step} → ${model || '(mặc định)'}`);
    } catch (err) { showToast(err.response?.data?.error || 'Lỗi', 'error'); }
    finally { setSaving(''); }
  };

  // Get default model for a step based on selected provider
  const getDefaultModel = (step) => {
    const providerMap = { ocr_text: 'ocr', ocr_vision: 'ocr', analyze: 'analyze', answer: 'answer' };
    const p = providers[providerMap[step]] || 'auto';
    const provider = p === 'auto' ? 'alibaba' : p;
    return settings?.defaultModels?.[provider]?.[step] || '';
  };

  // Get active model display (override or default)
  const getActiveModel = (step) => {
    return models[step] || getDefaultModel(step);
  };

  if (loading) return <div className={styles.loading}>Đang tải...</div>;
  if (!settings) return <div className={styles.error}>Không có quyền truy cập</div>;

  return (
    <div className={styles.container}>
      {toast && <div className={`${styles.toast} ${styles[`toast_${toast.type}`]}`}>{toast.msg}</div>}

      <header className={styles.header}>
        <Link href="/" className={styles.back}>← Trang chủ</Link>
        <h1>Admin Settings</h1>
        <p>Owner: <strong>{settings.ownerEmail}</strong></p>
      </header>

      {/* Pipeline overview with active models */}
      <section className={styles.card}>
        <h2>Pipeline xử lý PDF</h2>
        <div className={styles.pipeline}>
          <div className={styles.pipeStep}><span>📄</span><small>PDF</small></div>
          <div className={styles.pipeArrow}>→</div>
          <div className={styles.pipeStep}>
            <span>🔍</span><small>OCR</small>
            <code className={styles.pipeModel}>{getActiveModel('ocr_vision')}</code>
          </div>
          <div className={styles.pipeArrow}>→</div>
          <div className={styles.pipeStep}>
            <span>🧠</span><small>Analyze</small>
            <code className={styles.pipeModel}>{getActiveModel('analyze')}</code>
          </div>
          <div className={styles.pipeArrow}>→</div>
          <div className={styles.pipeStep}>
            <span>💬</span><small>Answer</small>
            <code className={styles.pipeModel}>{getActiveModel('answer')}</code>
          </div>
        </div>
      </section>

      {/* OCR Provider + Models */}
      <section className={styles.card}>
        <h2>🔍 Bước 1 — OCR (trích xuất từ PDF)</h2>
        <p className={styles.hint}>Provider:</p>
        <ProviderRadio options={OCR_OPTIONS} value={providers.ocr} onChange={v => setProviders(p => ({ ...p, ocr: v }))} name="ocrProvider" />
        <button className={styles.saveBtn} onClick={() => saveProviderSetting('ocr', providers.ocr)} disabled={saving === 'ocr'}>
          {saving === 'ocr' ? '...' : 'Lưu Provider'}
        </button>

        <div className={styles.modelSection}>
          <h3>Model tùy chỉnh (để trống = mặc định)</h3>
          <ModelInput label="OCR Text" step="ocr_text" value={models.ocr_text}
            onChange={v => setModels(m => ({ ...m, ocr_text: v }))} onSave={saveModel} saving={saving}
            defaultModel={getDefaultModel('ocr_text')} />
          <ModelInput label="OCR Vision" step="ocr_vision" value={models.ocr_vision}
            onChange={v => setModels(m => ({ ...m, ocr_vision: v }))} onSave={saveModel} saving={saving}
            defaultModel={getDefaultModel('ocr_vision')} />
        </div>
      </section>

      {/* OCR Prompt Template */}
      <section className={styles.card}>
        <h2>📝 Prompt OCR tùy chỉnh</h2>
        <p className={styles.hint}>
          Tùy chỉnh prompt gửi đến AI khi trích xuất đề thi từ PDF.
          Để trống để dùng prompt mặc định.
        </p>
        <textarea
          className={styles.input}
          style={{ width: '100%', minHeight: 200, fontFamily: 'monospace', fontSize: 13, resize: 'vertical' }}
          placeholder="Để trống = dùng prompt mặc định..."
          value={ocrPrompt}
          onChange={e => setOcrPrompt(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className={styles.saveBtn} onClick={saveOcrPrompt} disabled={saving === 'ocrPrompt'}>
            {saving === 'ocrPrompt' ? '...' : 'Lưu Prompt'}
          </button>
          <button className={styles.saveBtn} style={{ background: '#999' }} onClick={() => { setOcrPrompt(''); }}>
            Reset mặc định
          </button>
        </div>
      </section>

      {/* Analyze Provider + Model */}
      <section className={styles.card}>
        <h2>🧠 Bước 2 — Analyze (phân loại câu hỏi)</h2>
        <p className={styles.hint}>Phân loại MCQ / điền chỗ trống / Đúng-Sai, xác định đáp án.</p>
        <ProviderRadio options={ANALYZE_OPTIONS} value={providers.analyze} onChange={v => setProviders(p => ({ ...p, analyze: v }))} name="analyzeProvider" />
        <button className={styles.saveBtn} onClick={() => saveProviderSetting('analyze', providers.analyze)} disabled={saving === 'analyze'}>
          {saving === 'analyze' ? '...' : 'Lưu Provider'}
        </button>

        <div className={styles.modelSection}>
          <h3>Model tùy chỉnh</h3>
          <ModelInput label="Analyze Model" step="analyze" value={models.analyze}
            onChange={v => setModels(m => ({ ...m, analyze: v }))} onSave={saveModel} saving={saving}
            defaultModel={getDefaultModel('analyze')} />
        </div>
      </section>

      {/* Answer Provider + Model */}
      <section className={styles.card}>
        <h2>💬 Bước 3 — Giải thích đáp án</h2>
        <p className={styles.hint}>Khi học sinh nhấn "Giải thích". Học sinh vẫn có thể đổi từng câu.</p>
        <ProviderRadio options={ANSWER_OPTIONS} value={providers.answer} onChange={v => setProviders(p => ({ ...p, answer: v }))} name="answerProvider" />
        <button className={styles.saveBtn} onClick={() => saveProviderSetting('answer', providers.answer)} disabled={saving === 'answer'}>
          {saving === 'answer' ? '...' : 'Lưu Provider'}
        </button>

        <div className={styles.modelSection}>
          <h3>Model tùy chỉnh</h3>
          <ModelInput label="Answer Model" step="answer" value={models.answer}
            onChange={v => setModels(m => ({ ...m, answer: v }))} onSave={saveModel} saving={saving}
            defaultModel={getDefaultModel('answer')} />
        </div>
      </section>

      {/* Admin Emails */}
      <section className={styles.card}>
        <h2>👤 Admin emails (quyền upload)</h2>
        <ul className={styles.emailList}>
          {(settings.adminEmails || []).map(email => (
            <li key={email} className={styles.emailItem}>
              <span>{email}</span>
              {email === settings.ownerEmail
                ? <span className={styles.ownerBadge}>Owner</span>
                : <button className={styles.removeBtn} onClick={() => removeEmail(email)}>Xóa</button>}
            </li>
          ))}
        </ul>
        <div className={styles.addRow}>
          <input className={styles.input} placeholder="Thêm email admin mới..." value={newEmail} onChange={e => setNewEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && addEmail()} />
          <button className={styles.addBtn} onClick={addEmail}>+ Thêm</button>
        </div>
      </section>

      {/* API Keys */}
      <section className={styles.card}>
        <h2>🔑 API Keys</h2>
        <p className={styles.hint}>Key hiện tại chỉ hiển thị 8 ký tự đầu.</p>
        {PROVIDERS.map(p => (
          <div key={p} className={styles.keyRow}>
            <div className={styles.keyLabel}>
              <strong>{PROVIDER_LABELS[p]}</strong>
              {settings.apiKeys?.[p]
                ? <span className={styles.keyStatus}>{settings.apiKeys[p]}</span>
                : <span className={styles.keyMissing}>Chưa cấu hình</span>}
            </div>
            <div className={styles.keyInput}>
              <input className={styles.input} type="password" placeholder={`${p.toUpperCase()}_API_KEY...`} value={keyInputs[p]} onChange={e => setKeyInputs(k => ({ ...k, [p]: e.target.value }))} />
              <button className={styles.saveBtn} onClick={() => saveKey(p)} disabled={saving === p}>{saving === p ? '...' : 'Lưu'}</button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
