const test = require('node:test');
const assert = require('node:assert');

test('generateAiImage handles generations and completions correctly', async () => {
  const axios = require('axios');
  const originalPost = axios.post;
  let endpointUsed = '';
  let payloadUsed = null;

  axios.post = async (url, body, config) => {
    if (url.includes('/images/generations')) {
      endpointUsed = 'generations';
      payloadUsed = body;
      return { data: { data: [{ url: 'https://test-cdn.google.com/gen.png' }] } };
    }
    if (url.includes('/chat/completions')) {
      endpointUsed = 'completions';
      payloadUsed = body;
      // 模拟 tokens 代理返回的特殊 message.images 结构
      return {
        data: {
          choices: [{
            message: {
              content: null,
              images: [{ image_url: { url: 'data:image/jpeg;base64,dGVzdA==' } }]
            }
          }]
        }
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    process.env.ANTHROPIC_BASE_URL = 'https://api.example.com';
    process.env.ANTHROPIC_AUTH_TOKEN = 'sk-test';

    delete require.cache[require.resolve('../ai-service')];
    const { generateAiImage } = require('../ai-service');

    // Test Case 1: generations endpoint (使用首选兜底模型 gpt-image-2 绘图)
    const resultGen = await generateAiImage('test prompt', 'generations');
    assert.strictEqual(endpointUsed, 'generations');
    assert.strictEqual(resultGen.type, 'url');
    assert.strictEqual(resultGen.data, 'https://test-cdn.google.com/gen.png');
    assert.strictEqual(payloadUsed.model, 'gpt-image-2');
    assert.strictEqual(payloadUsed.prompt, 'test prompt');

    // Test Case 2: completions endpoint
    const resultComp = await generateAiImage('test prompt 2', 'completions');
    assert.strictEqual(endpointUsed, 'completions');
    assert.strictEqual(resultComp.type, 'buffer');
    assert.deepStrictEqual(resultComp.data, Buffer.from('test'));
    assert.strictEqual(payloadUsed.model, 'gemini-3.1-flash-image');
    assert.deepStrictEqual(payloadUsed.messages, [{ role: 'user', content: 'test prompt 2' }]);

  } finally {
    axios.post = originalPost;
    delete require.cache[require.resolve('../ai-service')];
  }
});
