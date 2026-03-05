// In-memory job store for tracking PDF upload/OCR progress
const jobs = new Map();

export function createJob(id, meta = {}) {
    jobs.set(id, {
        id,
        status: 'processing', // 'processing' | 'done' | 'error' | 'stopped'
        step: '',
        progress: 0,
        total: 0,
        message: 'Đang khởi động...',
        questionCount: 0,
        result: null,
        error: null,
        stopped: false,
        batches: [],          // [{ batch, pages, questionCount, questions[] }]
        questions: [],        // all questions found so far (flat)
        // Resume metadata
        meta: {
            filePath: meta.filePath || null,
            fileId: meta.fileId || null,
            fileImagesDir: meta.fileImagesDir || null,
            templateId: meta.templateId || null,
            customPrompt: meta.customPrompt || null,
            strategy: meta.strategy || null,  // 'text' | 'vision'
            title: meta.title || null,
            subject: meta.subject || null,
            grade: meta.grade || null,
            tags: meta.tags || [],
            fileHash: meta.fileHash || null,
            userEmail: meta.userEmail || null,
            originalName: meta.originalName || null,
            lastBatchIndex: 0,
            ...meta,
        },
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

export function getJobs() {
    // Return all jobs sorted by creation time (newest first), without full question data to save bandwidth
    return Array.from(jobs.values())
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(j => ({
            ...j,
            questions: undefined,  // strip full questions from list view
            batchQuestionCount: j.questions?.length || 0,
        }));
}

export function stopJob(id) {
    const job = jobs.get(id);
    if (job && job.status === 'processing') {
        job.stopped = true;
        job.status = 'stopped';
        job.message = `Đã dừng. ${job.questions?.length || 0} câu đã trích xuất`;
        jobs.set(id, job);
        return true;
    }
    return false;
}

export function resumeJob(id) {
    const job = jobs.get(id);
    if (job && (job.status === 'stopped' || job.status === 'error')) {
        job.stopped = false;
        job.status = 'processing';
        job.error = null;
        job.message = 'Đang tiếp tục xử lý...';
        jobs.set(id, job);
        return job;
    }
    return null;
}

export function isJobStopped(id) {
    const job = jobs.get(id);
    return job?.stopped === true;
}

// Auto-cleanup jobs older than 2 hours
setInterval(() => {
    const now = Date.now();
    for (const [id, job] of jobs.entries()) {
        if (now - job.createdAt > 7_200_000) jobs.delete(id);
    }
}, 300_000);
