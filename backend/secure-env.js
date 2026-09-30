/**
 * 在应用启动时调用，解密 .env.enc 并注入 process.env
 * 需要系统环境变量 APP_MASTER_KEY
 * 若 APP_MASTER_KEY 不存在则回退到读取 .env（本地开发兼容）
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function loadSecureEnv() {
  const masterKey = process.env.APP_MASTER_KEY;
  const encPath = path.join(__dirname, '.env.enc');
  const plainPath = path.join(__dirname, '.env');

  // 优先用加密文件
  if (masterKey && fs.existsSync(encPath)) {
    try {
      const raw = Buffer.from(fs.readFileSync(encPath, 'utf8').trim(), 'base64');
      const iv = raw.subarray(0, 12);
      const authTag = raw.subarray(12, 28);
      const ciphertext = raw.subarray(28);

      const key = crypto.scryptSync(masterKey, 'news-index-salt', 32);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const plaintext = decipher.update(ciphertext) + decipher.final('utf8');

      // 解析 KEY=VALUE 并注入 process.env（不覆盖已有值）
      for (const line of plaintext.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const k = trimmed.slice(0, eq).trim();
        const v = trimmed.slice(eq + 1).trim();
        if (k && !(k in process.env)) {
          process.env[k] = v;
        }
      }
      console.log('[secure-env] ✓ 已从加密文件加载密钥');
      return;
    } catch (e) {
      console.error('[secure-env] 解密失败，请检查 APP_MASTER_KEY 是否正确:', e.message);
      process.exit(1);
    }
  }

  // 回退：本地开发读取 .env
  if (fs.existsSync(plainPath)) {
    require('dotenv').config({ path: plainPath });
    console.log('[secure-env] ⚠ 使用明文 .env（仅限本地开发）');
  }
}

module.exports = loadSecureEnv;
