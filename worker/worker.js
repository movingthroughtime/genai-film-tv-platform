const Queue = require('bull');
const axios = require('axios');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'http://localhost:9000';

const generationQueue = new Queue('generation', REDIS_URL);

generationQueue.process(async (job) => {
  const { sceneId, projectId, title, brief, taskType, userId } = job.data;

  console.log(`Processing job ${job.id} for scene ${sceneId}: ${taskType}`);

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
    jobId: job.id,
    sceneId,
    projectId,
    taskType,
    result: response.data,
    assetEndpoint: MINIO_ENDPOINT,
    createdAt: new Date().toISOString()
  };

  return result;
});

generationQueue.on('completed', (job, result) => {
  console.log(`Job ${job.id} completed (${result.taskType})`);
});

generationQueue.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed: ${err.message}`);
});

console.log('Worker listening for generation jobs...');
