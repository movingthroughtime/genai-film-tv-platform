const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const Queue = require('bull');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 4000;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const generationQueue = new Queue('generation', REDIS_URL);

app.use(cors());
app.use(bodyParser.json());

const projects = new Map();
const scenes = new Map();
const jobs = new Map();

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'backend' });
});

app.get('/api/projects', (req, res) => {
  res.json(Array.from(projects.values()));
});

app.get('/api/projects/:projectId', (req, res) => {
  const project = projects.get(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

app.post('/api/projects', (req, res) => {
  const projectId = req.body.id || uuidv4();
  const project = {
    id: projectId,
    title: req.body.title || 'Untitled project',
    description: req.body.description || '',
    createdAt: new Date().toISOString()
  };
  projects.set(projectId, project);
  res.status(201).json(project);
});

app.post('/api/projects/:projectId/scenes', async (req, res) => {
  const { projectId } = req.params;
  const { title, brief, tasks = ['script'] } = req.body;

  if (!projects.has(projectId)) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const sceneId = uuidv4();
  const scene = {
    id: sceneId,
    projectId,
    title: title || 'Untitled scene',
    brief: brief || '',
    status: 'queued',
    createdAt: new Date().toISOString(),
    tasks: Array.isArray(tasks) ? tasks : [tasks]
  };
  scenes.set(sceneId, scene);

  const createdJobs = [];
  for (const taskType of scene.tasks) {
    const job = await generationQueue.add(
      {
        sceneId,
        projectId,
        title: scene.title,
        brief: scene.brief,
        taskType
      },
      {
        attempts: 3,
        backoff: 5000,
        removeOnComplete: false,
        removeOnFail: false
      }
    );

    const record = {
      id: job.id,
      sceneId,
      projectId,
      taskType,
      status: 'queued',
      createdAt: new Date().toISOString(),
      data: job.data
    };
    jobs.set(job.id, record);
    createdJobs.push(record);
  }

  res.status(202).json({ scene, jobs: createdJobs });
});

app.get('/api/scenes/:sceneId', (req, res) => {
  const scene = scenes.get(req.params.sceneId);
  if (!scene) return res.status(404).json({ error: 'Scene not found' });
  res.json(scene);
});

app.get('/api/jobs/:jobId', async (req, res) => {
  const job = await generationQueue.getJob(req.params.jobId);
  if (!job) {
    const record = jobs.get(req.params.jobId);
    if (!record) return res.status(404).json({ error: 'Job not found' });
    return res.json(record);
  }

  const state = await job.getState();
  const record = jobs.get(req.params.jobId) || {
    id: job.id,
    status: state,
    createdAt: new Date().toISOString()
  };

  record.status = state;
  record.result = job.returnvalue;
  record.attemptsMade = job.attemptsMade;
  jobs.set(req.params.jobId, record);

  res.json(record);
});

app.get('/api/jobs', (req, res) => {
  res.json(Array.from(jobs.values()));
});

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
