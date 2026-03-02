import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS exams (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        subject VARCHAR(100),
        questions JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        user_email VARCHAR(255)
      )
    `);
    console.log('Database tables initialized');
  } finally {
    client.release();
  }
}

export async function saveExam(title, subject, questions, userEmail = null) {
  const result = await pool.query(
    'INSERT INTO exams (title, subject, questions, user_email) VALUES ($1, $2, $3, $4) RETURNING id',
    [title, subject, JSON.stringify(questions), userEmail]
  );
  return result.rows[0].id;
}

export async function getExams() {
  const result = await pool.query('SELECT id, title, subject, created_at FROM exams ORDER BY created_at DESC');
  return result.rows;
}

export async function getExamById(id) {
  const result = await pool.query('SELECT * FROM exams WHERE id = $1', [id]);
  return result.rows[0];
}

export async function deleteExam(id) {
  await pool.query('DELETE FROM exams WHERE id = $1', [id]);
}
