const test = require('node:test');
const assert = require('node:assert');

// RED: callGeminiApi should retry transient "No available accounts" errors
// and eventually succeed if a later attempt returns a valid response.
// This guards against upstream Gemini account-pool starvation that the
// `api.example.com` proxy exhibits under burst load.

test('callGeminiApi retries on "No available accounts" then succeeds', async () => {
  const axios = require('axios');
  const originalPost = axios.post;
  let calls = 0;
  axios.post = async (url, body, config) => {
    calls += 1;
    if (calls < 3) {
      const err = new Error('Request failed');
      err.response = { data: { error: { message: 'No available accounts: no available accounts' } } };
      throw err;
    }
    return { data: { choices: [{ message: { content: '{"title":"ok","content":"ok"}' } }] } };
  };

  try {
    process.env.ANTHROPIC_BASE_URL = 'https://api.example.com';
    process.env.ANTHROPIC_AUTH_TOKEN = 'sk-test';
    // Re-require after stubbing so module picks up env
    delete require.cache[require.resolve('../ai-service')];
    const { callGeminiApi } = require('../ai-service');
    const result = await callGeminiApi('test prompt');
    assert.strictEqual(result.title, 'ok');
    assert.strictEqual(result.content, 'ok');
    assert.ok(calls >= 3, `expected at least 3 calls, got ${calls}`);
  } finally {
    axios.post = originalPost;
    delete require.cache[require.resolve('../ai-service')];
  }
});

test('callGeminiApi throws after exhausting retries', async () => {
  const axios = require('axios');
  const originalPost = axios.post;
  let calls = 0;
  axios.post = async () => {
    calls += 1;
    const err = new Error('Request failed');
    err.response = { data: { error: { message: 'No available accounts' } } };
    throw err;
  };

  try {
    delete require.cache[require.resolve('../ai-service')];
    const { callGeminiApi } = require('../ai-service');
    await assert.rejects(() => callGeminiApi('test'), /AI/);
    assert.ok(calls >= 2, `expected at least 2 attempts, got ${calls}`);
  } finally {
    axios.post = originalPost;
    delete require.cache[require.resolve('../ai-service')];
  }
});
