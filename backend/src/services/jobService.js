// In-memory job store for tracking PDF upload/OCR progress
const jobs = new Map();

export function createJob(id) {
    jobs.set(id, {
        id,
        status: 'processing', // 'processing' | 'done' | 'error' | 'stopped'
        step: '',
        progress: 0,    // pages processed so far
        total: 0,       // total pages
        message: 'Đang khởi động...',
        questionCount: 0,
        result: null,
        error: null,
        stopped: false,  // signal to stop processing
        batches: [],     // batch-by-batch results: [{ batch, pages, questionCount, questions }]
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

export function stopJob(id) {
    const job = jobs.get(id);
    if (job && job.status === 'processing') {
        job.stopped = true;
        job.status = 'stopped';
        job.message = 'Đã dừng xử lý';
        jobs.set(id, job);
        return true;
    }
    return false;
}

export function isJobStopped(id) {
    const job = jobs.get(id);
    return job?.stopped === true;
}

// Auto-cleanup jobs older than 1 hour
setInterval(() => {
    const now = Date.now();
    for (const [id, job] of jobs.entries()) {
        if (now - job.createdAt > 3_600_000) jobs.delete(id);
    }
}, 300_000);
