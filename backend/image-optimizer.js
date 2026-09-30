const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 82;
const PNG_COMPRESSION = 9;
const PNG_QUALITY = 82;
const MIN_SIZE_TO_PROCESS = 30 * 1024; // 30KB
const CORRUPT_SIZE_THRESHOLD = 1024;   // 1KB

const SUPPORTED_EXT = new Set(['.jpg', '.jpeg', '.png']);

const RESULT_STATUS = Object.freeze({
    COMPRESSED: 'compressed',
    SKIPPED_SMALL: 'skipped_small',
    SKIPPED_UNSUPPORTED: 'skipped_unsupported',
    SKIPPED_GREW: 'skipped_grew',
    DELETED_CORRUPT: 'deleted_corrupt',
    ERROR: 'error',
});

/**
 * 读取单文件的图片元数据（尺寸、格式）。失败返回 null。
 */
async function readImageMeta(filePath) {
    try {
        const meta = await sharp(filePath, { failOn: 'none' }).metadata();
        if (!meta || !meta.format) return null;
        return meta;
    } catch (err) {
        return null;
    }
}

/**
 * 判断给定路径对应的扩展名是否在压缩支持范围。
 */
function isSupportedExt(filePath) {
    return SUPPORTED_EXT.has(path.extname(filePath).toLowerCase());
}

/**
 * 判断文件是否体积过小（疑似爬虫失败留下的损坏空壳）。
 */
function isCorruptSize(stat) {
    return stat.size > 0 && stat.size < CORRUPT_SIZE_THRESHOLD;
}

/**
 * 在 Windows 上 fs.rename 偶发 EPERM（残留 tmp / 临时文件锁）。改用 copyFile + unlink 更稳。
 */
async function replaceFileAtomic(srcTmp, dest) {
    // 先尝试 rename（POSIX 原子）；失败再 fallback 到 copy + unlink
    try {
        await fs.promises.rename(srcTmp, dest);
        return;
    } catch (renameErr) {
        // Windows 上 EPERM/EBUSY/EACCES 都属于此情形，走 fallback
    }
    await fs.promises.copyFile(srcTmp, dest);
    try { await fs.promises.unlink(srcTmp); } catch (_) { /* ignore */ }
}

/**
 * 原地优化单张图片：写 .tmp 再原子替换，失败回滚。
 *
 * @param {string} filePath 绝对路径
 * @returns {Promise<{status: string, before: number, after: number, savedBytes: number, reason?: string}>}
 */
async function optimizeImageInPlace(filePath) {
    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch (err) {
        return { status: RESULT_STATUS.ERROR, before: 0, after: 0, savedBytes: 0, reason: err.code || 'stat_failed' };
    }

    // 损坏文件直接删
    if (isCorruptSize(stat)) {
        try {
            fs.unlinkSync(filePath);
            return { status: RESULT_STATUS.DELETED_CORRUPT, before: stat.size, after: 0, savedBytes: stat.size };
        } catch (err) {
            return { status: RESULT_STATUS.ERROR, before: stat.size, after: stat.size, savedBytes: 0, reason: 'delete_failed:' + err.message };
        }
    }

    // 已够小，跳过
    if (stat.size < MIN_SIZE_TO_PROCESS) {
        return { status: RESULT_STATUS.SKIPPED_SMALL, before: stat.size, after: stat.size, savedBytes: 0 };
    }

    // 非支持格式
    if (!isSupportedExt(filePath)) {
        return { status: RESULT_STATUS.SKIPPED_UNSUPPORTED, before: stat.size, after: stat.size, savedBytes: 0 };
    }

    const ext = path.extname(filePath).toLowerCase();
    const tmpPath = filePath + '.opt.tmp';

    // 防御性清理：之前中断可能留下的 .opt.tmp
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }

    try {
        // 先把整张图读入内存，再交给 sharp，避免 sharp 在源文件上持有长生命周期句柄
        // （这是 Windows 上 async rename 偶发 EPERM 的根因）。
        const inputBuffer = await fs.promises.readFile(filePath);
        const meta = await sharp(inputBuffer).metadata();
        if (!meta || !meta.format) {
            return { status: RESULT_STATUS.SKIPPED_UNSUPPORTED, before: stat.size, after: stat.size, savedBytes: 0, reason: 'meta_unreadable' };
        }

        let pipeline = sharp(inputBuffer).rotate(); // 按 EXIF 自动旋转，避免 strip 后方向不对

        // 限制最大边
        const needsResize =
            (meta.width && meta.width > MAX_DIMENSION) ||
            (meta.height && meta.height > MAX_DIMENSION);
        if (needsResize) {
            pipeline = pipeline.resize({
                width: MAX_DIMENSION,
                height: MAX_DIMENSION,
                fit: 'inside',
                withoutEnlargement: true,
            });
        }

        if (ext === '.jpg' || ext === '.jpeg') {
            pipeline = pipeline.jpeg({
                quality: JPEG_QUALITY,
                mozjpeg: true,
                progressive: true,
                chromaSubsampling: '4:2:0',
            });
        } else {
            // png
            pipeline = pipeline.png({
                compressionLevel: PNG_COMPRESSION,
                palette: true,
                quality: PNG_QUALITY,
            });
        }

        const buffer = await pipeline.toBuffer();

        // 压缩后体积没减小 → 回滚
        if (buffer.length >= stat.size) {
            return { status: RESULT_STATUS.SKIPPED_GREW, before: stat.size, after: stat.size, savedBytes: 0 };
        }

        // 用同步写+同步 rename，避开 Windows 上 async rename 偶发 EPERM 的文件句柄 race。
        // 数据已在内存（sharp.toBuffer），同步写不阻塞 I/O 太久。
        try {
            fs.writeFileSync(tmpPath, buffer);
            fs.renameSync(tmpPath, filePath);
        } catch (replaceErr) {
            try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
            throw replaceErr;
        }

        return {
            status: RESULT_STATUS.COMPRESSED,
            before: stat.size,
            after: buffer.length,
            savedBytes: stat.size - buffer.length,
        };
    } catch (err) {
        // 清理可能残留的 tmp
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
        return { status: RESULT_STATUS.ERROR, before: stat.size, after: stat.size, savedBytes: 0, reason: err.message };
    }
}

/**
 * 批量处理一个目录下的所有图片。返回统计汇总。
 *
 * @param {string} dirPath
 * @param {{dryRun?: boolean}} options
 */
async function optimizeImagesDir(dirPath, options = {}) {
    const { dryRun = false } = options;

    if (!fs.existsSync(dirPath)) {
        throw new Error(`Directory not found: ${dirPath}`);
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => path.join(dirPath, e.name));

    const stats = {
        scanned: files.length,
        compressed: 0,
        deletedCorrupt: 0,
        skippedSmall: 0,
        skippedUnsupported: 0,
        skippedGrew: 0,
        errors: 0,
        beforeBytes: 0,
        afterBytes: 0,
        savedBytes: 0,
        dryRun,
    };

    for (const filePath of files) {
        if (dryRun) {
            let st;
            try { st = fs.statSync(filePath); } catch (_) { continue; }
            if (isCorruptSize(st)) {
                stats.deletedCorrupt++;
                stats.beforeBytes += st.size;
                continue;
            }
            if (!isSupportedExt(filePath)) {
                stats.skippedUnsupported++;
                stats.beforeBytes += st.size;
                continue;
            }
            if (st.size < MIN_SIZE_TO_PROCESS) {
                stats.skippedSmall++;
                stats.beforeBytes += st.size;
                continue;
            }
            stats.compressed++;
            stats.beforeBytes += st.size;
            continue;
        }

        const result = await optimizeImageInPlace(filePath);
        stats.beforeBytes += result.before;
        switch (result.status) {
            case RESULT_STATUS.COMPRESSED:
                stats.compressed++;
                stats.afterBytes += result.after;
                stats.savedBytes += result.savedBytes;
                break;
            case RESULT_STATUS.DELETED_CORRUPT:
                stats.deletedCorrupt++;
                stats.afterBytes += 0;
                stats.savedBytes += result.savedBytes;
                break;
            case RESULT_STATUS.SKIPPED_SMALL:
                stats.skippedSmall++;
                stats.afterBytes += result.after;
                break;
            case RESULT_STATUS.SKIPPED_UNSUPPORTED:
                stats.skippedUnsupported++;
                stats.afterBytes += result.after;
                break;
            case RESULT_STATUS.SKIPPED_GREW:
                stats.skippedGrew++;
                stats.afterBytes += result.after;
                break;
            case RESULT_STATUS.ERROR:
            default:
                stats.errors++;
                stats.afterBytes += result.after;
                break;
        }
    }

    return stats;
}

function formatBytes(n) {
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}

module.exports = {
    optimizeImageInPlace,
    optimizeImagesDir,
    isCorruptSize,
    isSupportedExt,
    RESULT_STATUS,
    formatBytes,
    MAX_DIMENSION,
    JPEG_QUALITY,
};