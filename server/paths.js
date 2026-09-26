const path = require('node:path');

const DATA_DIR = process.env.DATA_DIR
  || (process.env.VERCEL ? path.join('/tmp', 'finance-data') : __dirname);

module.exports = { DATA_DIR };
