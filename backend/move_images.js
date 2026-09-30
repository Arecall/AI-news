const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'frontend/public/images');
const destDir = path.join(__dirname, '../frontend/public/images');

if (fs.existsSync(srcDir)) {
    console.log('Found wrong image directory. Moving files...');
    const files = fs.readdirSync(srcDir);
    files.forEach(file => {
        if (file.endsWith('.jpg') || file.endsWith('.png')) {
            const srcPath = path.join(srcDir, file);
            const destPath = path.join(destDir, file);
            fs.copyFileSync(srcPath, destPath);
            fs.unlinkSync(srcPath);
            console.log(`Moved: ${file}`);
        }
    });

    // Clean up empty directories
    try {
        fs.rmSync(path.join(__dirname, 'frontend'), { recursive: true, force: true });
        console.log('Cleaned up backend/frontend directory.');
    } catch (err) {
        console.error('Error removing folder:', err.message);
    }
} else {
    console.log('No wrong image directory found.');
}
