const fetchAndProcessNews = require('./crawler');
const db = require('./db');

(async () => {
  console.log('开始手动执行 24 小时 AI 新闻增量爬取任务 (不清理旧数据)...');
  try {
    await fetchAndProcessNews();
    console.log('爬取任务执行结束。');
  } catch (error) {
    console.error('爬取任务出错:', error);
  }
})();
