const path = require('path');
const fs = require('fs');
const db = require('./db');

const FALLBACK_IMAGES = [
    'ogimage.png',
    'banner1.png',
    'meta-img.png',
    'social-v3-deprecations.jpg',
    '/images/ogimage.png',
    '/images/banner1.png',
    '/images/meta-img.png',
    '/images/social-v3-deprecations.jpg'
];

function getImagesDir() {
    return process.env.IMAGES_DIR || path.join(__dirname, '../frontend/public/images');
}

/**
 * 助手函数：删除记录引用的本地图片文件（如果是本地图片且没有被其他新闻记录引用，也不是系统默认兜底图片）
 * @param {Array<string>} imageUrls 要处理的图片路径列表
 * @param {object} activeDb 数据库实例
 */
function cleanUnusedImages(imageUrls, activeDb) {
    if (!imageUrls || imageUrls.length === 0) return;

    const imagesDir = getImagesDir();

    for (const imgUrl of imageUrls) {
        if (!imgUrl || typeof imgUrl !== 'string') continue;

        // 排除系统静态兜底图
        const isFallback = FALLBACK_IMAGES.some(fb => imgUrl.endsWith(fb));
        if (isFallback) continue;

        // 只处理相对路径 /images/xxx.jpg
        if (!imgUrl.startsWith('/images/')) continue;

        // 检查数据库中是否还有其他新闻引用这张图片
        const checkRefStmt = activeDb.prepare('SELECT COUNT(*) as count FROM news WHERE imageUrl = ?');
        const refCount = checkRefStmt.get(imgUrl)?.count || 0;

        if (refCount === 0) {
            const fileName = path.basename(imgUrl);
            const filePath = path.join(imagesDir, fileName);
            if (fs.existsSync(filePath)) {
                try {
                    fs.unlinkSync(filePath);
                    console.log(`[Cleaner] 清理无用图片文件: ${filePath}`);
                } catch (e) {
                    console.error(`[Cleaner] 删除图片文件失败: ${filePath}`, e.message);
                }
            }
        }
    }
}

/**
 * 新闻自动清理与维护方法
 * @param {object} options 可选配置，包含 customDb (用于单元测试) 和 maxLimit (默认 1500)
 */
function cleanupNews(options = {}) {
    const activeDb = options.customDb || db;
    const maxLimit = options.maxLimit || 1500;

    console.log('[Cleaner] 开始执行新闻数据库清理任务...');

    let deletedImageUrls = [];

    // 步骤 1: 删除转译失败 / 无效的记录
    // 条件：title 或 content 为空/Null，或 title 包含转译失败标记，或 content 包含异常错误标记
    const findFailedStmt = activeDb.prepare(`
        SELECT id, imageUrl FROM news
        WHERE title IS NULL OR title = ''
           OR content IS NULL OR content = ''
           OR title LIKE '%转译失败%'
           OR title LIKE '%Failed to translate%'
    `);
    const failedRows = findFailedStmt.all();

    if (failedRows.length > 0) {
        const failedIds = failedRows.map(r => r.id);
        failedRows.forEach(r => { if (r.imageUrl) deletedImageUrls.push(r.imageUrl); });

        const deleteFailedStmt = activeDb.prepare(`DELETE FROM news WHERE id IN (${failedIds.join(',')})`);
        const result = deleteFailedStmt.run();
        console.log(`[Cleaner] 已清理转译失败/无效记录 ${result.changes} 条`);
    }

    // 步骤 2: 清理重复记录 (按 originalUrl 或 title 去重，保留最新 ID/createdAt 的记录)
    // 2.1 按 originalUrl 去重
    const findDupUrlStmt = activeDb.prepare(`
        SELECT n1.id, n1.imageUrl
        FROM news n1
        INNER JOIN (
            SELECT originalUrl, MAX(id) as max_id
            FROM news
            WHERE originalUrl IS NOT NULL AND originalUrl != ''
            GROUP BY originalUrl
            HAVING COUNT(*) > 1
        ) dup ON n1.originalUrl = dup.originalUrl AND n1.id < dup.max_id
    `);
    const dupUrlRows = findDupUrlStmt.all();
    if (dupUrlRows.length > 0) {
        const dupUrlIds = dupUrlRows.map(r => r.id);
        dupUrlRows.forEach(r => { if (r.imageUrl) deletedImageUrls.push(r.imageUrl); });

        const deleteDupUrlStmt = activeDb.prepare(`DELETE FROM news WHERE id IN (${dupUrlIds.join(',')})`);
        const result = deleteDupUrlStmt.run();
        console.log(`[Cleaner] 已清理 originalUrl 重复记录 ${result.changes} 条`);
    }

    // 2.2 按 title 去重
    const findDupTitleStmt = activeDb.prepare(`
        SELECT n1.id, n1.imageUrl
        FROM news n1
        INNER JOIN (
            SELECT title, MAX(id) as max_id
            FROM news
            WHERE title IS NOT NULL AND title != ''
            GROUP BY title
            HAVING COUNT(*) > 1
        ) dup ON n1.title = dup.title AND n1.id < dup.max_id
    `);
    const dupTitleRows = findDupTitleStmt.all();
    if (dupTitleRows.length > 0) {
        const dupTitleIds = dupTitleRows.map(r => r.id);
        dupTitleRows.forEach(r => { if (r.imageUrl) deletedImageUrls.push(r.imageUrl); });

        const deleteDupTitleStmt = activeDb.prepare(`DELETE FROM news WHERE id IN (${dupTitleIds.join(',')})`);
        const result = deleteDupTitleStmt.run();
        console.log(`[Cleaner] 已清理 title 重复记录 ${result.changes} 条`);
    }

    // 步骤 3: 限制最大数据量上限 (如大于 maxLimit 则清理最老的数据)
    const countRow = activeDb.prepare('SELECT COUNT(*) as total FROM news').get();
    const currentTotal = countRow.total;

    if (currentTotal > maxLimit) {
        const excessCount = currentTotal - maxLimit;
        console.log(`[Cleaner] 当前新闻条数 (${currentTotal}) 超过上限 (${maxLimit})，准备自动清理最老的 ${excessCount} 条数据...`);

        const findOldStmt = activeDb.prepare(`
            SELECT id, imageUrl FROM news
            ORDER BY createdAt ASC, id ASC
            LIMIT ?
        `);
        const oldRows = findOldStmt.all(excessCount);

        if (oldRows.length > 0) {
            const oldIds = oldRows.map(r => r.id);
            oldRows.forEach(r => { if (r.imageUrl) deletedImageUrls.push(r.imageUrl); });

            const deleteOldStmt = activeDb.prepare(`DELETE FROM news WHERE id IN (${oldIds.join(',')})`);
            const result = deleteOldStmt.run();
            console.log(`[Cleaner] 已自动覆盖/删除老数据 ${result.changes} 条`);
        }
    }

    // 步骤 4: 清理无引用的物理图片文件
    cleanUnusedImages(deletedImageUrls, activeDb);

    console.log('[Cleaner] 新闻数据清理任务完成。');
    return {
        success: true
    };
}

module.exports = { cleanupNews, cleanUnusedImages };
