import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const OWNER_EMAIL = 'phupn1510@gmail.com'; // permanent super-admin, cannot be removed

export async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS exams (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        subject VARCHAR(100),
        questions JSONB NOT NULL,
        tags TEXT[] DEFAULT '{}',
        file_hash VARCHAR(64),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        user_email VARCHAR(255)
      )
    `);
    // Migrate existing tables (ALTER TABLE is idempotent with IF NOT EXISTS)
    await client.query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'`);
    await client.query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS file_hash VARCHAR(64)`);
    await client.query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS grade VARCHAR(5) DEFAULT '2'`);
    // Create indexes only after columns are guaranteed to exist
    try { await client.query(`CREATE INDEX IF NOT EXISTS idx_exams_hash ON exams(file_hash)`); } catch (_) {}
    try { await client.query(`CREATE INDEX IF NOT EXISTS idx_exams_tags ON exams USING GIN(tags)`); } catch (_) {}
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS exam_page_images (
        id SERIAL PRIMARY KEY,
        exam_id INTEGER NOT NULL,
        page_number INTEGER NOT NULL,
        image_data TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    try { await client.query(`CREATE INDEX IF NOT EXISTS idx_page_images_exam ON exam_page_images(exam_id)`); } catch (_) {}
    console.log('Database tables initialized');
  } finally {
    client.release();
  }
}

// ─── Exams ────────────────────────────────────────────────────────────────────

export async function checkExamByHash(fileHash) {
  const result = await pool.query('SELECT id, title FROM exams WHERE file_hash = $1 LIMIT 1', [fileHash]);
  return result.rows[0] || null;
}

export async function saveExam(title, subject, questions, userEmail = null, fileHash = null, tags = [], grade = '2') {
  const result = await pool.query(
    'INSERT INTO exams (title, subject, questions, user_email, file_hash, tags, grade) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    [title, subject, JSON.stringify(questions), userEmail, fileHash, tags, grade]
  );
  return result.rows[0].id;
}

export async function getExams() {
  const result = await pool.query('SELECT id, title, subject, grade, tags, created_at FROM exams ORDER BY created_at DESC');
  return result.rows;
}

export async function getExamById(id) {
  const result = await pool.query('SELECT * FROM exams WHERE id = $1', [id]);
  return result.rows[0];
}

export async function deleteExam(id) {
  await pool.query('DELETE FROM exam_page_images WHERE exam_id = $1', [id]);
  await pool.query('DELETE FROM exams WHERE id = $1', [id]);
}

// ─── Page Images ─────────────────────────────────────────────────────────────

export async function savePageImage(examId, pageNumber, base64Data) {
  await pool.query(
    'INSERT INTO exam_page_images (exam_id, page_number, image_data) VALUES ($1, $2, $3)',
    [examId, pageNumber, base64Data]
  );
}

export async function getPageImages(examId) {
  const result = await pool.query(
    'SELECT page_number FROM exam_page_images WHERE exam_id = $1 ORDER BY page_number',
    [examId]
  );
  return result.rows;
}

export async function getPageImage(examId, pageNumber) {
  const result = await pool.query(
    'SELECT image_data FROM exam_page_images WHERE exam_id = $1 AND page_number = $2',
    [examId, pageNumber]
  );
  return result.rows[0]?.image_data ?? null;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

async function getSetting(key) {
  const result = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return result.rows[0]?.value ?? null;
}

export { getSetting };

async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, value]
  );
}

export { setSetting };

// ─── Admin Emails ─────────────────────────────────────────────────────────────

export async function getAdminEmails() {
  try {
    const raw = await getSetting('admin_emails');
    const dbEmails = raw ? JSON.parse(raw) : [];
    // Always include owner
    const all = [OWNER_EMAIL, ...dbEmails.filter(e => e !== OWNER_EMAIL)];
    return all;
  } catch {
    return [OWNER_EMAIL];
  }
}

export async function addAdminEmail(email) {
  const normalized = email.trim().toLowerCase();
  if (normalized === OWNER_EMAIL) return; // already exists
  const emails = await getAdminEmails();
  if (!emails.includes(normalized)) {
    const updatable = emails.filter(e => e !== OWNER_EMAIL);
    await setSetting('admin_emails', JSON.stringify([...updatable, normalized]));
  }
}

export async function removeAdminEmail(email) {
  const normalized = email.trim().toLowerCase();
  if (normalized === OWNER_EMAIL) throw new Error('Cannot remove the owner account');
  const emails = await getAdminEmails();
  const updatable = emails.filter(e => e !== OWNER_EMAIL && e !== normalized);
  await setSetting('admin_emails', JSON.stringify(updatable));
}

// ─── API Keys ─────────────────────────────────────────────────────────────────

export async function getApiKey(provider) {
  // DB overrides env
  const fromDb = await getSetting(`api_key_${provider}`);
  if (fromDb) return fromDb;
  const envMap = { openai: 'OPENAI_API_KEY', kimi: 'KIMI_API_KEY', gemini: 'GEMINI_API_KEY' };
  return process.env[envMap[provider]] || null;
}

export async function setApiKey(provider, key) {
  await setSetting(`api_key_${provider}`, key);
}
