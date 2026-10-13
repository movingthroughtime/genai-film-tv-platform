const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Queue = require('bull');
const fs = require('fs');
const path = require('path');
const Minio = require('minio');

const app = express();
const PORT = process.env.PORT || 4000;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/genai';
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'localhost';
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin';
const MINIO_PORT = Number(process.env.MINIO_PORT || 9000);
const MINIO_USE_SSL = String(process.env.MINIO_USE_SSL || 'false').toLowerCase() === 'true';

const generationQueue = new Queue('generation', REDIS_URL);
const db = new Pool({
  connectionString: DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

const minioClient = new Minio.Client({
  endPoint: MINIO_ENDPOINT,
  port: MINIO_PORT,
  useSSL: MINIO_USE_SSL,
  accessKey: MINIO_ACCESS_KEY,
  secretKey: MINIO_SECRET_KEY
});

const memory = {
  users: new Map(),
  projects: new Map(),
  scenes: new Map(),
  jobs: new Map(),
  templates: new Map(),
  models: new Map(),
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

const demoModels = [
  { id: 'model-script-v1', name: 'script-v1', provider: 'openai', type: 'script', version: '1.0.0', status: 'active', metadata: { notes: 'Cinematic script generation model' } },
  { id: 'model-storyboard-v1', name: 'storyboard-v1', provider: 'openai', type: 'storyboard', version: '1.0.0', status: 'active', metadata: { notes: 'Storyboard framing model' } },
  { id: 'model-shotlist-v1', name: 'shotlist-v1', provider: 'openai', type: 'shotlist', version: '1.0.0', status: 'active', metadata: { notes: 'Shot planning model' } }
];

demoModels.forEach((model) => memory.models.set(model.id, model));

let dbReady = false;

function parsePagination(req) {
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  return { limit, offset };
}

async function initDb() {
  try {
    await db.query('SELECT 1');
    dbReady = true;
    console.log('PostgreSQL connected');
    await ensureDbSchema();
  } catch (err) {
    console.warn('PostgreSQL unavailable, using in-memory fallback:', err.message);
  }
}

async function ensureDbSchema() {
  if (!dbReady) return;
  try {
    const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await db.query(schemaSql);
  } catch (err) {
    console.warn('Schema init warning:', err.message);
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
    req.user = jwt.verify(token, JWT_SECRET);
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
  if (memory.auditLogs.length > 5000) {
    memory.auditLogs.length = 5000;
  }
  if (dbReady) {
    db.query(
      'INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5, $6)',
      [entry.id, entry.actorId, entry.action, entry.entityType, entry.entityId, JSON.stringify(details)]
    ).catch((err) => console.warn('Audit insert failed:', err.message));
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
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, template = EXCLUDED.template, variables = EXCLUDED.variables, is_active = EXCLUDED.is_active, created_at = NOW()
      RETURNING *;
    `;
    const row = await db.query(query, [template.id, template.name, template.description || '', template.template, JSON.stringify(template.variables || []), template.isActive !== false, template.createdBy || '']);
    return row.rows[0] || template;
  } catch (err) {
    console.warn('Template insert failed:', err.message);
    return template;
  }
}

async function dbInsertModel(model) {
  if (!dbReady) return model;
  try {
    const query = `
      INSERT INTO model_registry (id, name, provider, type, version, status, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, provider = EXCLUDED.provider, type = EXCLUDED.type, version = EXCLUDED.version, status = EXCLUDED.status, metadata = EXCLUDED.metadata
      RETURNING *;
    `;
    const row = await db.query(query, [model.id, model.name, model.provider, model.type, model.version, model.status, JSON.stringify(model.metadata || {})]);
    return row.rows[0] || model;
  } catch (err) {
    console.warn('Model insert failed:', err.message);
    return model;
  }
}

async function getProjects({ limit = 25, offset = 0 } = {}) {
  if (dbReady) {
    const result = await db.query('SELECT * FROM projects ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
    return result.rows;
  }
  return Array.from(memory.projects.values()).slice(offset, offset + limit);
}

async function getProjectById(projectId) {
  if (dbReady) {
    const result = await db.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    return result.rows[0] || null;
  }
  return memory.projects.get(projectId) || null;
}

async function getJobs({ limit = 25, offset = 0 } = {}) {
  if (dbReady) {
    const result = await db.query('SELECT * FROM jobs ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
    return result.rows;
  }
  return Array.from(memory.jobs.values()).slice(offset, offset + limit);
}

async function getJobById(jobId) {
  if (dbReady) {
    const result = await db.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
    return result.rows[0] || null;
  }
  return memory.jobs.get(jobId) || null;
}

async function getTemplates({ limit = 25, offset = 0 } = {}) {
  if (dbReady) {
    const result = await db.query('SELECT * FROM prompt_templates ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
    return result.rows;
  }
  return Array.from(memory.templates.values()).slice(offset, offset + limit);
}

async function getModels({ limit = 25, offset = 0 } = {}) {
  if (dbReady) {
    const result = await db.query('SELECT * FROM model_registry ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
    return result.rows;
  }
  return Array.from(memory.models.values()).slice(offset, offset + limit);
}

async function getApprovals({ limit = 25, offset = 0 } = {}) {
  if (dbReady) {
    const result = await db.query('SELECT * FROM approvals ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
    return result.rows;
  }
  return Array.from(memory.approvals.values()).slice(offset, offset + limit);
}

async function ensureBucket() {
  const bucket = 'studio-assets';
  const exists = await minioClient.bucketExists(bucket).catch(() => false);
  if (!exists) {
    await minioClient.makeBucket(bucket, 'us-east-1').catch(() => {});
  }
  return bucket;
}

async function uploadToMinio({ key, type, content, metadata = {} }) {
  if (!minioClient || !key) return null;

  try {
    const bucket = await ensureBucket();
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content || '', 'utf8');
    await minioClient.putObject(bucket, key, buffer, buffer.length, {
      'Content-Type': type || 'application/octet-stream',
      'x-amz-meta-source': 'genai-platform',
      ...metadata
    });

    return {
      bucket,
      key,
      url: `${MINIO_USE_SSL ? 'https' : 'http'}://${MINIO_ENDPOINT}:${MINIO_PORT}/${bucket}/${key}`
    };
  } catch (err) {
    console.warn('MinIO upload failed:', err.message);
    return null;
  }
}

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

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
  const { limit, offset } = parsePagination(req);
  const projects = await getProjects({ limit, offset });
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

    memory.jobs.set(job.id, job);
    await dbInsertJob(job);

    await generationQueue.add({
      jobId,
      sceneId,
      projectId: project.id,
      title: scene.title,
      brief: scene.brief,
      taskType,
      userId: req.user.sub
    }, {
      jobId,
      attempts: 3,
      backoff: 5000
    });

    createdJobs.push({ ...job, status: 'queued' });
  }

  addAuditLog({ actorId: req.user.sub, action: 'scene.created', entityType: 'scene', entityId: sceneId, details: { projectId: project.id, tasks } });
  res.status(202).json({ scene, jobs: createdJobs });
});

app.get('/api/scenes/:sceneId', async (req, res) => {
  const scene = memory.scenes.get(req.params.sceneId);
  if (!scene) return res.status(404).json({ error: 'Scene not found' });
  res.json(scene);
});

app.get('/api/jobs', async (req, res) => {
  const { limit, offset } = parsePagination(req);
  const jobs = await getJobs({ limit, offset });
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
  const { limit, offset } = parsePagination(req);
  res.json(await getTemplates({ limit, offset }));
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

app.get('/api/models', async (req, res) => {
  const { limit, offset } = parsePagination(req);
  res.json(await getModels({ limit, offset }));
});

app.post('/api/models', requireRole(['producer', 'admin']), async (req, res) => {
  const model = {
    id: uuidv4(),
    name: req.body.name || 'new-model',
    provider: req.body.provider || 'openai',
    type: req.body.type || 'script',
    version: req.body.version || '1.0.0',
    status: req.body.status || 'active',
    metadata: req.body.metadata || {},
    createdAt: new Date().toISOString()
  };

  memory.models.set(model.id, model);
  await dbInsertModel(model);
  addAuditLog({ actorId: req.user.sub, action: 'model.registered', entityType: 'model', entityId: model.id, details: { name: model.name, version: model.version } });
  res.status(201).json(model);
});

app.get('/api/approvals', async (req, res) => {
  const { limit, offset } = parsePagination(req);
  const approvals = await getApprovals({ limit, offset });
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

app.post('/api/assets/upload', requireRole(['writer', 'director', 'producer', 'admin']), async (req, res) => {
  const { key, type, content, metadata } = req.body || {};
  if (!key) return res.status(400).json({ error: 'Asset key is required' });

  const uploadResult = await uploadToMinio({
    key,
    type: type || 'application/octet-stream',
    content,
    metadata: metadata || {}
  });

  const asset = {
    id: uuidv4(),
    key,
    type: type || 'application/octet-stream',
    metadata: {
      ...(metadata || {}),
      uploadedBy: req.user.sub,
      storage: uploadResult ? 'minio' : 'memory'
    },
    createdAt: new Date().toISOString(),
    url: uploadResult ? uploadResult.url : null
  };

  addAuditLog({ actorId: req.user.sub, action: 'asset.uploaded', entityType: 'asset', entityId: key, details: { key, type: asset.type, url: asset.url } });
  res.status(201).json(asset);
});

app.get('/api/audit-logs', requireRole(['director', 'producer', 'admin']), async (req, res) => {
  const { limit, offset } = parsePagination(req);
  res.json(memory.auditLogs.slice(offset, offset + limit));
});

app.get('/api/assets', async (req, res) => {
  const { limit, offset } = parsePagination(req);
  if (!dbReady) return res.json([]);
  const result = await db.query('SELECT * FROM assets ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
  res.json(result.rows);
});

initDb().catch(console.error);

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
