// Student Management System - in-memory REST API (Node 20+, no dependencies)
// Modules: Students, Teachers, Attendance, Marks  (full CRUD each)
const http = require('node:http');

const PORT = process.env.PORT || 3002;

// ---------- In-memory "database" ----------
const db = {
  students: new Map(),
  teachers: new Map(),
  attendance: new Map(),
  marks: new Map(),
};
const counters = { students: 1, teachers: 1, attendance: 1, marks: 1 };

// ---------- Helpers ----------
// We stringify because res.end() only accepts a string/Buffer/Uint8Array,
// and HTTP is just text/bytes on the wire. JSON.stringify turns the JS object
// into JSON text the client can parse back with response.json().
const reply = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

class HttpError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) { reject(new HttpError(413, 'Body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(new HttpError(400, 'Invalid JSON body')); }
    });
    req.on('error', reject);
  });

const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isDate = (v) => isStr(v) && !Number.isNaN(Date.parse(v));
const isEmail = (v) => isStr(v) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

// ---------- Module definitions ----------
// fields: { name: { check, required, message } }
// validate(data): optional cross-collection checks
const modules = {
  students: {
    fields: {
      name: { check: isStr, required: true, message: 'name is required' },
      email: { check: isEmail, required: true, message: 'valid email is required' },
      rollNo: { check: isStr, required: true, message: 'rollNo is required' },
      className: { check: isStr, required: true, message: 'className is required' },
      age: { check: (v) => isNum(v) && v > 0, required: false, message: 'age must be a positive number' },
    },
    unique: ['email', 'rollNo'],
  },
  teachers: {
    fields: {
      name: { check: isStr, required: true, message: 'name is required' },
      email: { check: isEmail, required: true, message: 'valid email is required' },
      subject: { check: isStr, required: true, message: 'subject is required' },
      phone: { check: isStr, required: false, message: 'phone must be a string' },
    },
    unique: ['email'],
  },
  attendance: {
    fields: {
      studentId: { check: isNum, required: true, message: 'studentId (number) is required' },
      date: { check: isDate, required: true, message: 'date (YYYY-MM-DD) is required' },
      status: { check: (v) => ['present', 'absent', 'late'].includes(v), required: true, message: "status must be 'present', 'absent' or 'late'" },
    },
    validate(data) {
      if (data.studentId !== undefined && !db.students.has(data.studentId))
        throw new HttpError(400, `Student ${data.studentId} does not exist`);
    },
    // one record per student per day
    uniqueCombo: ['studentId', 'date'],
  },
  marks: {
    fields: {
      studentId: { check: isNum, required: true, message: 'studentId (number) is required' },
      teacherId: { check: isNum, required: false, message: 'teacherId must be a number' },
      subject: { check: isStr, required: true, message: 'subject is required' },
      exam: { check: isStr, required: true, message: "exam is required (e.g. 'Midterm')" },
      score: { check: (v) => isNum(v) && v >= 0, required: true, message: 'score must be a number >= 0' },
      maxScore: { check: (v) => isNum(v) && v > 0, required: true, message: 'maxScore must be a number > 0' },
    },
    validate(data) {
      if (data.studentId !== undefined && !db.students.has(data.studentId))
        throw new HttpError(400, `Student ${data.studentId} does not exist`);
      if (data.teacherId !== undefined && !db.teachers.has(data.teacherId))
        throw new HttpError(400, `Teacher ${data.teacherId} does not exist`);
      if (data.score !== undefined && data.maxScore !== undefined && data.score > data.maxScore)
        throw new HttpError(400, 'score cannot exceed maxScore');
    },
  },
};

// Validate body against a module's schema. partial=true for PATCH-style updates.
function validateBody(name, body, { partial = false, currentId = null } = {}) {
  const mod = modules[name];
  const errors = [];
  const data = {};

  for (const [field, rule] of Object.entries(mod.fields)) {
    const value = body[field];
    if (value === undefined) {
      if (rule.required && !partial) errors.push(rule.message);
      continue;
    }
    if (!rule.check(value)) errors.push(rule.message);
    else data[field] = typeof value === 'string' ? value.trim() : value;
  }
  if (errors.length) throw new HttpError(400, errors.join('; '));

  const others = [...db[name].values()].filter((r) => r.id !== currentId);
  for (const f of mod.unique ?? []) {
    if (data[f] !== undefined && others.some((r) => r[f] === data[f]))
      throw new HttpError(409, `${f} '${data[f]}' already exists`);
  }
  mod.validate?.(data);
  return data;
}

function checkComboUnique(name, merged, currentId) {
  const combo = modules[name].uniqueCombo;
  if (!combo) return;
  const clash = [...db[name].values()].some(
    (r) => r.id !== currentId && combo.every((f) => r[f] === merged[f])
  );
  if (clash) throw new HttpError(409, `A record with the same ${combo.join(' + ')} already exists`);
}

// ---------- Generic CRUD handlers ----------
function list(name, query) {
  let rows = [...db[name].values()];
  // simple filtering: /marks?studentId=1&subject=Math
  for (const [key, val] of query.entries()) {
    if (!(key in modules[name].fields)) continue;
    rows = rows.filter((r) => String(r[key]).toLowerCase() === val.toLowerCase());
  }
  return rows;
}

function create(name, body) {
  const data = validateBody(name, body);
  checkComboUnique(name, data, null);
  const now = new Date().toISOString();
  const record = { id: counters[name]++, ...data, createdAt: now, updatedAt: now };
  db[name].set(record.id, record);
  return record;
}

function update(name, id, body, partial) {
  const existing = db[name].get(id);
  if (!existing) throw new HttpError(404, `${name.slice(0, -1)} ${id} not found`);
  const data = validateBody(name, body, { partial, currentId: id });
  const merged = { ...existing, ...data };
  // re-run cross checks on the merged record (e.g. score <= maxScore)
  modules[name].validate?.(merged);
  checkComboUnique(name, merged, id);
  merged.updatedAt = new Date().toISOString();
  db[name].set(id, merged);
  return merged;
}

function remove(name, id) {
  if (!db[name].has(id)) throw new HttpError(404, `${name.slice(0, -1)} ${id} not found`);
  db[name].delete(id);
  // cascade: deleting a student removes their attendance and marks
  if (name === 'students') {
    for (const col of ['attendance', 'marks'])
      for (const [rid, r] of db[col]) if (r.studentId === id) db[col].delete(rid);
  }
  // deleting a teacher just unlinks them from marks
  if (name === 'teachers') {
    for (const r of db.marks.values()) if (r.teacherId === id) delete r.teacherId;
  }
}

// ---------- Server / routing ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean); // ['students', '3']
  const [resource, rawId, extra] = parts;

  try {
    // --- root: welcome + list of endpoints ---
    if (req.method === 'GET' && url.pathname === '/') {
      return reply(res, 200, {
        message: 'Student Management System API is running',
        endpoints: {
          health: '/health',
          students: '/students',
          teachers: '/teachers',
          attendance: '/attendance',
          marks: '/marks',
          studentReport: '/students/:id/report',
        },
      });
    }

    // --- existing routes ---
    if (req.method === 'GET' && url.pathname === '/health') {
      return reply(res, 200, { status: 'ok' });
    }
    if (req.method === 'GET' && url.pathname === '/hello') {
      return reply(res, 200, { message: `Hello ${url.searchParams.get('name') ?? 'Guest'}` });
    }

    // --- bonus: student report card (attendance % + marks) ---
    if (req.method === 'GET' && resource === 'students' && rawId && extra === 'report') {
      const id = Number(rawId);
      const student = db.students.get(id);
      if (!student) throw new HttpError(404, `student ${id} not found`);
      const att = [...db.attendance.values()].filter((a) => a.studentId === id);
      const present = att.filter((a) => a.status !== 'absent').length;
      const marks = [...db.marks.values()].filter((m) => m.studentId === id);
      const totalScore = marks.reduce((s, m) => s + m.score, 0);
      const totalMax = marks.reduce((s, m) => s + m.maxScore, 0);
      return reply(res, 200, {
        student,
        attendance: {
          totalDays: att.length,
          present,
          percentage: att.length ? +((present / att.length) * 100).toFixed(1) : null,
        },
        marks,
        overallPercentage: totalMax ? +((totalScore / totalMax) * 100).toFixed(1) : null,
      });
    }

    // --- CRUD routes ---
    if (resource in modules && !extra) {
      const hasId = rawId !== undefined;
      const id = hasId ? Number(rawId) : null;
      if (hasId && !Number.isInteger(id)) throw new HttpError(400, 'id must be an integer');

      if (!hasId) {
        if (req.method === 'GET') return reply(res, 200, list(resource, url.searchParams));
        if (req.method === 'POST') return reply(res, 201, create(resource, await readBody(req)));
      } else {
        if (req.method === 'GET') {
          const rec = db[resource].get(id);
          if (!rec) throw new HttpError(404, `${resource.slice(0, -1)} ${id} not found`);
          return reply(res, 200, rec);
        }
        if (req.method === 'PUT') return reply(res, 200, update(resource, id, await readBody(req), false));
        if (req.method === 'PATCH') return reply(res, 200, update(resource, id, await readBody(req), true));
        if (req.method === 'DELETE') { remove(resource, id); return reply(res, 204); }
      }
      throw new HttpError(405, `Method ${req.method} not allowed on ${url.pathname}`);
    }

    reply(res, 404, { error: 'Route not found' });
  } catch (err) {
    if (err instanceof HttpError) return reply(res, err.code, { error: err.message });
    console.error(err);
    reply(res, 500, { error: 'Internal server error' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Student Management System on http://localhost:${PORT}`));
}
module.exports = server;
