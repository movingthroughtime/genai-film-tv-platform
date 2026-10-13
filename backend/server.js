const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Queue = require('bull');

const app = express();
const PORT = process.env.PORT || 4000;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/genai';
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

const generationQueue = new Queue('generation', REDIS_URL);

const memory = {
  projects: new Map(),
  scenes: new Map(),
  jobs: new Map(),
  users: new Map()
};

let dbReady = false;
const db = new Client({ connectionString: DATABASE_URL });

async function initDb() {
  try {
    await db.connect();
    dbReady = true;
    console.log('Connected to PostgreSQL');
  } catch (err) {
    console.warn('PostgreSQL unavailable; using in-memory fallback:', err.message);
  }
}

function createToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

async function dbInsertProject(project) {
  if (!dbReady) return null;
  const q = `
    INSERT INTO projects (id, owner_id, title, description)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, updated_at = NOW()
    RETURNING *;
  `;
  const result = await db.query(q, [project.id, project.ownerId || null, project.title, project.description || '']);
  return result.rows[0];
}

async function dbListProjects() {
  if (!dbReady) return Array.from(memory.projects.values());
  const result = await db.query('SELECT * FROM projects ORDER BY created_at DESC');
  return result.rows;
}

async function dbGetProject(projectId) {
  if (!dbReady) return memory.projects.get(projectId) || null;
  const result = await db.query('SELECT * FROM projects WHERE id = $1', [projectId]);
  return result.rows[0] || null;
}

async function dbInsertScene(scene) {
  if (!dbReady) return null;
  const query = `
    INSERT INTO scenes (id, project_id, title, brief, status)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *;
  `;
  const result = await db.query(query, [scene.id, scene.projectId, scene.title, scene.brief || '', scene.status]);
  return result.rows[0];
}

async function dbGetScene(sceneId) {
  if (!dbReady) return memory.scenes.get(sceneId) || null;
  const result = await db.query('SELECT * FROM scenes WHERE id = $1', [sceneId]);
  return result.rows[0] || null;
}

async function dbInsertJob(job) {
  if (!dbReady) return null;
  const query = `
    INSERT INTO jobs (id, scene_id, project_id, task_type, status, payload)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *;
  `;
  const result = await db.query(query, [job.id, job.sceneId, job.projectId, job.taskType, job.status, JSON.stringify(job.payload || {})]);
  return result.rows[0];
}

async function dbListJobs() {
  if (!dbReady) return Array.from(memory.jobs.values());
  const result = await db.query('SELECT * FROM jobs ORDER BY created_at DESC');
  return result.rows;
}

async function dbGetJob(jobId) {
  if (!dbReady) return memory.jobs.get(jobId) || null;
  const result = await db.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  return result.rows[0] || null;
}

async function dbUpdateJobStatus(jobId, status, result = null) {
  if (!dbReady) {
    const existing = memory.jobs.get(jobId);
    if (existing) {
      existing.status = status;
      existing.result = result;
      existing.updatedAt = new Date().toISOString();
    }
    return existing;
  }

  const query = `
    UPDATE jobs
    SET status = $2, result = $3, updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;
  const resultRows = await db.query(query, [jobId, status, result ? JSON.stringify(result) : null]);
  return resultRows.rows[0] || null;
}

app.use(cors());
app.use(bodyParser.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'backend', dbReady });
});

app.post('/api/auth/login', async (req, res) => {
  const email = (req.body.email || 'demo@studio.local').toLowerCase();
  const name = req.body.name || 'Demo User';
  const role = req.body.role || 'writer';

  let user = memory.users.get(email);
  if (!user) {
    user = { id: uuidv4(), email, name, role };
    memory.users.set(email, user);
    if (dbReady) {
      try {
        await db.query(
          'INSERT INTO users (id, email, name, role) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING',
          [user.id, email, name, role]
        );
      } catch (err) {
        console.warn('User insert failed:', err.message);
      }
    }
  }

  const token = createToken(user);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

app.use('/api', requireAuth);

app.get('/api/projects', async (req, res) => {
  const projects = await dbListProjects();
  res.json(projects);
});

app.get('/api/projects/:projectId', async (req, res) => {
  const project = await dbGetProject(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

app.post('/api/projects', async (req, res) => {
  const project = {
    id: uuidv4(),
    ownerId: req.user.sub,
    title: req.body.title || 'Untitled project',
    description: req.body.description || ''
  };

  memory.projects.set(project.id, project);
  await dbInsertProject(project);
  res.status(201).json(project);
});

app.post('/api/projects/:projectId/scenes', async (req, res) => {
  const project = await dbGetProject(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const sceneId = uuidv4();
  const scene = {
    id: sceneId,
    projectId: project.id,
    title: req.body.title || 'Untitled scene',
    brief: req.body.brief || '',
    status: 'queued',
    createdAt: new Date().toISOString(),
    tasks: Array.isArray(req.body.tasks) ? req.body.tasks : [req.body.tasks || 'script']
  };

  memory.scenes.set(sceneId, scene);
  await dbInsertScene({ ...scene, projectId: project.id, status: 'queued' });

  const createdJobs = [];
  for (const taskType of scene.tasks) {
    const job = await generationQueue.add({
      sceneId,
      projectId: project.id,
      title: scene.title,
      brief: scene.brief,
      taskType,
      userId: req.user.sub
    }, {
      attempts: 3,
      backoff: 5000,
      removeOnComplete: false,
      removeOnFail: false
    });

    const jobRecord = {
      id: job.id,
      sceneId,
      projectId: project.id,
      taskType,
      status: 'queued',
      createdAt: new Date().toISOString(),
      payload: job.data
    };

    memory.jobs.set(job.id, jobRecord);
    await dbInsertJob({
      id: job.id,
      sceneId,
      projectId: project.id,
      taskType,
      status: 'queued',
      payload: job.data
    });
    createdJobs.push(jobRecord);
  }

  res.status(202).json({ scene, jobs: createdJobs });
});

app.get('/api/scenes/:sceneId', async (req, res) => {
  const scene = await dbGetScene(req.params.sceneId);
  if (!scene) return res.status(404).json({ error: 'Scene not found' });
  res.json(scene);
});

app.get('/api/jobs', async (req, res) => {
  const jobs = await dbListJobs();
  res.json(jobs);
});

app.get('/api/jobs/:jobId', async (req, res) => {
  const queueJob = await generationQueue.getJob(req.params.jobId);
  let record = await dbGetJob(req.params.jobId);

  if (!record && !queueJob) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (queueJob) {
    const state = await queueJob.getState();
    record = record || { id: queueJob.id, status: state };
    record.status = state;
    record.result = queueJob.returnvalue;
    record.attemptsMade = queueJob.attemptsMade;
    await dbUpdateJobStatus(queueJob.id, state, queueJob.returnvalue || null);
  }

  if (record && !record.result && memory.jobs.has(req.params.jobId)) {
    record = memory.jobs.get(req.params.jobId);
  }

  res.json(record);
});

app.get('/api/assets', async (req, res) => {
  if (!dbReady) return res.json([]);
  const result = await db.query('SELECT * FROM assets ORDER BY created_at DESC');
  res.json(result.rows);
});

async function ensureDbSchema() {
  if (!dbReady) return;
  const fs = require('fs');
  const path = require('path');
  const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await db.query(schemaSql);
}

initDb().then(() => ensureDbSchema()).catch(console.error);

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
