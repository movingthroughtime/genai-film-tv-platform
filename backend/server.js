const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Queue = require('bull');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/genai';
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
const generationQueue = new Queue('generation', REDIS_URL);

const db = new Client({ connectionString: DATABASE_URL });
const memory = {
  users: new Map(),
  projects: new Map(),
  scenes: new Map(),
  jobs: new Map(),
  templates: new Map(),
  approvals: new Map(),
  auditLogs: []
};

const demoUsers = [
  { id: 'user-writer', email: 'writer@studio.local', name: 'Writer User', role: 'writer' },
  { id: 'user-director', email: 'director@studio.local', name: 'Director User', role: 'director' },
  { id: 'user-producer', email: 'producer@studio.local', name: 'Producer User', role: 'producer' },
  { id: 'user-admin', email: 'admin@studio.local', name: 'Admin User', role: 'admin' }
];

demoUsers.forEach((user) => memory.users.set(user.email.toLowerCase(), user));

let dbReady = false;

async function ensureDbSchema() {
  if (!dbReady) return;
  try {
    const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await db.query(schemaSql);
  } catch (err) {
    console.warn('Schema init warning:', err.message);
  }
}

async function initDb() {
  try {
    await db.connect();
    dbReady = true;
    console.log('PostgreSQL connected');
    await ensureDbSchema();
  } catch (err) {
    console.warn('PostgreSQL unavailable, using in-memory fallback:', err.message);
  }
}

function createToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(roles) {
  return (req, res, next) => {
    const role = req.user && req.user.role;
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ error: 'Insufficient role permissions' });
    }
    return next();
  };
}

function addAuditLog({ actorId, action, entityType, entityId, details = {} }) {
  const entry = {
    id: uuidv4(),
    actorId: actorId || 'system',
    action,
    entityType,
    entityId,
    details,
    createdAt: new Date().toISOString()
  };
  memory.auditLogs.unshift(entry);
  if (dbReady) {
    db.query(
      'INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5, $6)',
      [entry.id, entry.actorId, entry.action, entry.entityType, entry.entityId, JSON.stringify(details)]
    ).catch((err) => console.warn('Audit log insert failed:', err.message));
  }
  return entry;
}

async function dbInsertProject(project) {
  if (!dbReady) return project;
  try {
    const query = `
      INSERT INTO projects (id, owner_id, title, description)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, updated_at = NOW()
      RETURNING *;
    `;
    const result = await db.query(query, [project.id, project.ownerId || null, project.title, project.description || '']);
    return result.rows[0];
  } catch (err) {
    console.warn('Project insert failed:', err.message);
    return project;
  }
}

async function dbInsertScene(scene) {
  if (!dbReady) return scene;
  try {
    const query = `
      INSERT INTO scenes (id, project_id, title, brief, status)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, brief = EXCLUDED.brief, status = EXCLUDED.status, updated_at = NOW()
      RETURNING *;
    `;
    const result = await db.query(query, [scene.id, scene.projectId, scene.title, scene.brief || '', scene.status]);
    return result.rows[0];
  } catch (err) {
    console.warn('Scene insert failed:', err.message);
    return scene;
  }
}

async function dbInsertJob(job) {
  if (!dbReady) return job;
  try {
    const query = `
      INSERT INTO jobs (id, scene_id, project_id, task_type, status, payload)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload, result = EXCLUDED.result, updated_at = NOW()
      RETURNING *;
    `;
    const result = await db.query(query, [job.id, job.sceneId, job.projectId, job.taskType, job.status, JSON.stringify(job.payload || {})]);
    return result.rows[0];
  } catch (err) {
    console.warn('Job insert failed:', err.message);
    return job;
  }
}

async function dbUpdateJob(jobId, status, result = null) {
  if (!dbReady) return null;
  try {
    const query = `
      UPDATE jobs
      SET status = $2, result = $3, updated_at = NOW()
      WHERE id = $1
      RETURNING *;
    `;
    const row = await db.query(query, [jobId, status, result ? JSON.stringify(result) : null]);
    return row.rows[0] || null;
  } catch (err) {
    console.warn('Job update failed:', err.message);
    return null;
  }
}

async function dbInsertApproval(approval) {
  if (!dbReady) return approval;
  try {
    const query = `
      INSERT INTO approvals (id, job_id, scene_id, status, comment, requested_by, approved_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, comment = EXCLUDED.comment, approved_by = EXCLUDED.approved_by, updated_at = NOW()
      RETURNING *;
    `;
    const row = await db.query(query, [approval.id, approval.jobId, approval.sceneId, approval.status, approval.comment || '', approval.requestedBy || '', approval.approvedBy || '']);
    return row.rows[0] || approval;
  } catch (err) {
    console.warn('Approval insert failed:', err.message);
    return approval;
  }
}

async function dbInsertTemplate(template) {
  if (!dbReady) return template;
  try {
    const query = `
      INSERT INTO prompt_templates (id, name, description, template, variables, is_active, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, template = EXCLUDED.template, variables = EXCLUDED.variables, is_active = EXCLUDED.is_active, created_by = EXCLUDED.created_by
      RETURNING *;
    `;
    const row = await db.query(query, [template.id, template.name, template.description || '', template.template, JSON.stringify(template.variables || []), template.isActive !== false, template.createdBy || '']);
    return row.rows[0] || template;
  } catch (err) {
    console.warn('Template insert failed:', err.message);
    return template;
  }
}

async function getProjects() {
  if (dbReady) {
    const result = await db.query('SELECT * FROM projects ORDER BY created_at DESC');
    return result.rows;
  }
  return Array.from(memory.projects.values());
}

async function getProjectById(projectId) {
  if (dbReady) {
    const result = await db.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    return result.rows[0] || null;
  }
  return memory.projects.get(projectId) || null;
}

async function getScenes() {
  if (dbReady) {
    const result = await db.query('SELECT * FROM scenes ORDER BY created_at DESC');
    return result.rows;
  }
  return Array.from(memory.scenes.values());
}

async function getSceneById(sceneId) {
  if (dbReady) {
    const result = await db.query('SELECT * FROM scenes WHERE id = $1', [sceneId]);
    return result.rows[0] || null;
  }
  return memory.scenes.get(sceneId) || null;
}

async function getJobs() {
  if (dbReady) {
    const result = await db.query('SELECT * FROM jobs ORDER BY created_at DESC');
    return result.rows;
  }
  return Array.from(memory.jobs.values());
}

async function getJobById(jobId) {
  if (dbReady) {
    const result = await db.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
    return result.rows[0] || null;
  }
  return memory.jobs.get(jobId) || null;
}

async function getTemplates() {
  if (dbReady) {
    const result = await db.query('SELECT * FROM prompt_templates ORDER BY created_at DESC');
    return result.rows;
  }
  return Array.from(memory.templates.values());
}

async function getApprovals() {
  if (dbReady) {
    const result = await db.query('SELECT * FROM approvals ORDER BY created_at DESC');
    return result.rows;
  }
  return Array.from(memory.approvals.values());
}

app.use(cors());
app.use(bodyParser.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'backend', dbReady });
});

app.post('/api/auth/login', async (req, res) => {
  const email = (req.body.email || 'writer@studio.local').toLowerCase();
  const name = req.body.name || 'Studio User';
  const role = (req.body.role || 'writer').toLowerCase();

  let user = memory.users.get(email);
  if (!user) {
    user = { id: uuidv4(), email, name, role };
    memory.users.set(email, user);
  } else {
    user.role = role;
    user.name = name;
  }

  if (dbReady) {
    try {
      await db.query(
        'INSERT INTO users (id, email, name, role) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role',
        [user.id, email, name, role]
      );
    } catch (err) {
      console.warn('User upsert failed:', err.message);
    }
  }

  const token = createToken(user);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = Array.from(memory.users.values()).find((u) => u.id === req.user.sub) || {
    id: req.user.sub,
    email: req.user.email,
    name: req.user.name,
    role: req.user.role
  };
  res.json(user);
});

app.use('/api', requireAuth);

app.get('/api/projects', async (req, res) => {
  const projects = await getProjects();
  res.json(projects);
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
  addAuditLog({ actorId: req.user.sub, action: 'project.created', entityType: 'project', entityId: project.id, details: { title: project.title } });
  res.status(201).json(project);
});

app.get('/api/projects/:projectId', async (req, res) => {
  const project = await getProjectById(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

app.post('/api/projects/:projectId/scenes', async (req, res) => {
  const project = await getProjectById(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const sceneId = uuidv4();
  const tasks = Array.isArray(req.body.tasks) ? req.body.tasks : [req.body.tasks || 'script'];
  const scene = {
    id: sceneId,
    projectId: project.id,
    title: req.body.title || 'Untitled scene',
    brief: req.body.brief || '',
    status: 'queued',
    createdAt: new Date().toISOString(),
    tasks
  };

  memory.scenes.set(sceneId, scene);
  await dbInsertScene({ ...scene, projectId: project.id, status: 'queued' });

  const createdJobs = [];
  for (const taskType of tasks) {
    const jobId = uuidv4();
    const job = {
      id: jobId,
      sceneId,
      projectId: project.id,
      taskType,
      status: 'queued',
      payload: { taskType, title: scene.title, brief: scene.brief },
      createdAt: new Date().toISOString()
    };

    memory.jobs.set(jobId, job);
    await dbInsertJob(job);

    const queueJob = await generationQueue.add({
      sceneId,
      projectId: project.id,
      title: scene.title,
      brief: scene.brief,
      taskType,
      userId: req.user.sub
    }, { attempts: 3, backoff: 5000 });

    job.queueId = queueJob.id;
    job.id = queueJob.id;
    memory.jobs.set(queueJob.id, { ...job, id: queueJob.id });
    await dbInsertJob({ ...job, id: queueJob.id });

    createdJobs.push({ ...job, id: queueJob.id, status: 'queued' });
  }

  addAuditLog({ actorId: req.user.sub, action: 'scene.created', entityType: 'scene', entityId: sceneId, details: { projectId: project.id, tasks } });
  res.status(202).json({ scene, jobs: createdJobs });
});

app.get('/api/scenes/:sceneId', async (req, res) => {
  const scene = await getSceneById(req.params.sceneId);
  if (!scene) return res.status(404).json({ error: 'Scene not found' });
  res.json(scene);
});

app.get('/api/jobs', async (req, res) => {
  const jobs = await getJobs();
  res.json(jobs);
});

app.get('/api/jobs/:jobId', async (req, res) => {
  const queueJob = await generationQueue.getJob(req.params.jobId);
  const record = await getJobById(req.params.jobId);

  if (!record && !queueJob) return res.status(404).json({ error: 'Job not found' });

  let jobSnapshot = record || { id: req.params.jobId, status: 'queued' };
  if (queueJob) {
    const state = await queueJob.getState();
    jobSnapshot.status = state;
    jobSnapshot.result = queueJob.returnvalue || null;
    jobSnapshot.attemptsMade = queueJob.attemptsMade;
    await dbUpdateJob(jobSnapshot.id, state, queueJob.returnvalue || null);
  }

  res.json(jobSnapshot);
});

app.get('/api/templates', async (req, res) => {
  res.json(await getTemplates());
});

app.post('/api/templates', requireRole(['producer', 'admin']), async (req, res) => {
  const template = {
    id: uuidv4(),
    name: req.body.name || 'New Template',
    description: req.body.description || '',
    template: req.body.template || '',
    variables: Array.isArray(req.body.variables) ? req.body.variables : [],
    isActive: req.body.isActive !== false,
    createdBy: req.user.sub,
    createdAt: new Date().toISOString()
  };

  memory.templates.set(template.id, template);
  await dbInsertTemplate(template);
  addAuditLog({ actorId: req.user.sub, action: 'template.created', entityType: 'template', entityId: template.id, details: { name: template.name } });
  res.status(201).json(template);
});

app.get('/api/approvals', async (req, res) => {
  const approvals = await getApprovals();
  res.json(approvals);
});

app.post('/api/jobs/:jobId/approve', requireRole(['director', 'producer', 'admin']), async (req, res) => {
  const job = await getJobById(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const status = (req.body.status || 'approved').toLowerCase();
  const approval = {
    id: uuidv4(),
    jobId: req.params.jobId,
    sceneId: job.sceneId,
    status,
    comment: req.body.comment || '',
    requestedBy: job.payload && job.payload.userId ? job.payload.userId : 'system',
    approvedBy: req.user.sub,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  memory.approvals.set(approval.id, approval);
  await dbInsertApproval(approval);

  // update job status for approval state
  if (status === 'approved') {
    job.status = 'approved';
    await dbUpdateJob(job.id, 'approved', job.result || {});
  } else if (status === 'rejected') {
    job.status = 'rejected';
    await dbUpdateJob(job.id, 'rejected', job.result || {});
  }

  addAuditLog({ actorId: req.user.sub, action: 'job.approved', entityType: 'job', entityId: req.params.jobId, details: { status, comment: approval.comment } });
  res.json({ approval, job });
});

app.get('/api/audit-logs', requireRole(['director', 'producer', 'admin']), async (req, res) => {
  res.json(memory.auditLogs.slice(0, 100));
});

app.get('/api/assets', async (req, res) => {
  if (!dbReady) return res.json([]);
  const result = await db.query('SELECT * FROM assets ORDER BY created_at DESC');
  res.json(result.rows);
});

initDb().catch(console.error);

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
