const Queue = require('bull');
const axios = require('axios');
const { Pool } = require('pg');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/genai';
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'http://localhost:9000';

const db = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

const generationQueue = new Queue('generation', REDIS_URL);

const concurrency = Number(process.env.WORKER_CONCURRENCY || 4);

generationQueue.process(concurrency, async (job) => {
  const { jobId, sceneId, projectId, title, brief, taskType, userId } = job.data;

  console.log(`Processing job ${jobId} for scene ${sceneId}: ${taskType}`);

  // mark as processing
  if (jobId) {
    try {
      await db.query(
        `UPDATE jobs SET status = $1, updated_at = NOW() WHERE id = $2`,
        ['processing', jobId]
      );
    } catch (e) {
      console.warn('Failed to mark job processing:', e.message);
    }
  }

  try {
    const response = await axios.post(`${ML_SERVICE_URL}/generate`, {
      sceneId,
      projectId,
      title,
      brief,
      taskType,
      userId
    }, {
      timeout: 120000
    });

    const result = {
      jobId,
      sceneId,
      projectId,
      taskType,
      result: response.data,
      assetEndpoint: MINIO_ENDPOINT,
      createdAt: new Date().toISOString()
    };

    if (jobId) {
      try {
        await db.query(
          `UPDATE jobs
           SET status = $1,
               result = $2,
               updated_at = NOW()
           WHERE id = $3`,
          ['completed', JSON.stringify(result), jobId]
        );
      } catch (e) {
        console.warn('Failed to persist job result:', e.message);
      }
    }

    return result;
  } catch (err) {
    console.error(`Job ${jobId} failed during generation:`, err.message);

    if (jobId) {
      try {
        await db.query(
          `UPDATE jobs
           SET status = $1,
               result = $2,
               updated_at = NOW()
           WHERE id = $3`,
          ['failed', JSON.stringify({ error: err.message }), jobId]
        );
      } catch (e) {
        console.warn('Failed to persist failed job status:', e.message);
      }
    }

    // rethrow so Bull records the failure and handles retries
    throw err;
  }
});

generationQueue.on('completed', (job, result) => {
  console.log(`Job ${job.data.jobId || job.id} completed (${job.data.taskType})`);
});

generationQueue.on('failed', (job, err) => {
  console.error(`Job ${job.data.jobId || job.id} failed: ${err.message}`);
});

console.log(`Worker listening for generation jobs (concurrency=${concurrency})...`);
