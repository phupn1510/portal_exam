// In-memory job store for tracking PDF upload/OCR progress
const jobs = new Map();

export function createJob(id) {
    jobs.set(id, {
        id,
        status: 'processing', // 'processing' | 'done' | 'error'
        step: '',
        progress: 0,    // pages processed so far
        total: 0,       // total pages
        message: 'Đang khởi động...',
        questionCount: 0,
        result: null,
        error: null,
        createdAt: Date.now()
    });
}

export function updateJob(id, updates) {
    const job = jobs.get(id);
    if (job) jobs.set(id, { ...job, ...updates });
}

export function getJob(id) {
    return jobs.get(id) || null;
}

// Auto-cleanup jobs older than 1 hour
setInterval(() => {
    const now = Date.now();
    for (const [id, job] of jobs.entries()) {
        if (now - job.createdAt > 3_600_000) jobs.delete(id);
    }
}, 300_000);
