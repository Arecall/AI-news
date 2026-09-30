const db = require('./db');

// ─── 持久化任务队列：进程崩溃后可以从 next_retry_at 恢复任务 ───
// 状态机：PENDING → PROCESSING → (DONE | FAILED | COOLING)
db.exec(`
  CREATE TABLE IF NOT EXISTS job_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type TEXT NOT NULL,           -- 'translate' | 'image'
    payload TEXT NOT NULL,            -- JSON 字符串
    status TEXT NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_retry_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_job_queue_status
    ON job_queue (status, next_retry_at);
`);

const stmtInsert = db.prepare(`
  INSERT INTO job_queue (job_type, payload, status, attempts, next_retry_at, created_at, updated_at)
  VALUES (?, ?, 'PENDING', 0, ?, ?, ?)
`);

const stmtFetchPending = db.prepare(`
  SELECT * FROM job_queue
  WHERE status IN ('PENDING', 'COOLING')
    AND next_retry_at <= ?
  ORDER BY id ASC
  LIMIT ?
`);

const stmtMarkProcessing = db.prepare(`
  UPDATE job_queue
  SET status = 'PROCESSING', attempts = attempts + 1, updated_at = ?
  WHERE id = ?
`);

const stmtMarkDone = db.prepare(`
  UPDATE job_queue SET status = 'DONE', updated_at = ? WHERE id = ?
`);

const stmtMarkFailed = db.prepare(`
  UPDATE job_queue SET status = 'FAILED', last_error = ?, updated_at = ? WHERE id = ?
`);

const stmtMarkCooling = db.prepare(`
  UPDATE job_queue
  SET status = 'COOLING', next_retry_at = ?, last_error = ?, updated_at = ?
  WHERE id = ?
`);

const stmtResetStale = db.prepare(`
  UPDATE job_queue
  SET status = 'PENDING', updated_at = ?
  WHERE status = 'PROCESSING'
`);

function now() {
  return Date.now();
}

function enqueue(jobType, payload) {
  const t = now();
  const info = stmtInsert.run(jobType, JSON.stringify(payload), t, t, t);
  return info.lastInsertRowid;
}

function fetchPending(limit = 5) {
  const t = now();
  const rows = stmtFetchPending.all(t, limit);
  return rows.map((row) => ({
    ...row,
    payload: safeParse(row.payload),
  }));
}

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function markProcessing(id) {
  stmtMarkProcessing.run(now(), id);
}

function markDone(id) {
  stmtMarkDone.run(now(), id);
}

function markFailed(id, error) {
  stmtMarkFailed.run(String(error?.message || error || 'unknown'), now(), id);
}

function markCooling(id, retryAt, error) {
  stmtMarkCooling.run(retryAt, String(error?.message || error || 'rate limited'), now(), id);
}

/**
 * 进程启动时调用：将所有“PROCESSING 中的任务”回退为 PENDING（崩溃恢复）
 */
function recoverStale() {
  const result = stmtResetStale.run(now());
  return result.changes || 0;
}

module.exports = {
  enqueue,
  fetchPending,
  markProcessing,
  markDone,
  markFailed,
  markCooling,
  recoverStale,
};
