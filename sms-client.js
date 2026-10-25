// Run sms-server.js first, then: node sms-client.js
const BASE = process.env.BASE || 'http://localhost:3002';

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, // objects must be stringified to send, too
  });
  const data = res.status === 204 ? null : await res.json();
  console.log(`${method.padEnd(6)} ${path.padEnd(22)} -> ${res.status}`, data ? JSON.stringify(data) : '');
  return { status: res.status, data };
}

async function main() {
  // Teachers
  const t = (await call('POST', '/teachers', { name: 'Mr. Khan', email: 'khan@school.com', subject: 'Math' })).data;
  await call('PATCH', `/teachers/${t.id}`, { phone: '0300-1234567' });

  // Students
  const s = (await call('POST', '/students', { name: 'Ali', email: 'ali@school.com', rollNo: 'R-01', className: '10-A', age: 15 })).data;
  await call('POST', '/students', { name: 'Ali2', email: 'ali@school.com', rollNo: 'R-02', className: '10-A' }); // 409 duplicate email
  await call('PUT', `/students/${s.id}`, { name: 'Ali Raza', email: 'ali@school.com', rollNo: 'R-01', className: '10-B' });

  // Attendance
  const a = (await call('POST', '/attendance', { studentId: s.id, date: '2026-10-24', status: 'present' })).data;
  await call('POST', '/attendance', { studentId: s.id, date: '2026-10-24', status: 'absent' }); // 409 same day
  await call('POST', '/attendance', { studentId: s.id, date: '2026-10-25', status: 'late' });
  await call('PATCH', `/attendance/${a.id}`, { status: 'late' });
  await call('GET', `/attendance?studentId=${s.id}`);

  // Marks
  const m = (await call('POST', '/marks', { studentId: s.id, teacherId: t.id, subject: 'Math', exam: 'Midterm', score: 42, maxScore: 50 })).data;
  await call('POST', '/marks', { studentId: 999, subject: 'Math', exam: 'Quiz', score: 5, maxScore: 10 }); // 400 no such student
  await call('PATCH', `/marks/${m.id}`, { score: 60 }); // 400 score > maxScore
  await call('PATCH', `/marks/${m.id}`, { score: 45 });

  // Report + list
  await call('GET', `/students/${s.id}/report`);
  await call('GET', '/students');

  // Delete (student delete cascades to attendance + marks)
  await call('DELETE', `/teachers/${t.id}`);
  await call('DELETE', `/students/${s.id}`);
  await call('GET', '/attendance');
  await call('GET', `/students/${s.id}`); // 404
}

main().catch((e) => { console.error('Start sms-server.js first:', e.message); process.exitCode = 1; });
