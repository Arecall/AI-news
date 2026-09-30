const test = require('node:test');
const assert = require('node:assert');

// RED: this test should fail because /api/news/count does not exist yet.
test('GET /api/news/count returns JSON object with positive numeric count', async () => {
  const app = require('../index');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/news/count`);
    assert.strictEqual(res.status, 200, 'expected 200 OK');
    const body = await res.json();
    assert.strictEqual(typeof body, 'object', 'expected JSON object');
    assert.strictEqual(typeof body.count, 'number', 'expected body.count to be a number');
    assert.ok(Number.isInteger(body.count), 'expected body.count to be an integer');
    assert.ok(body.count > 0, `expected body.count > 0, got ${body.count}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});