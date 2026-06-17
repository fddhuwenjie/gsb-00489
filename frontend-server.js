const express = require('express');
const path = require('path');

const app = express();
const PORT = 3489;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`前端服务器运行在 http://localhost:${PORT}`);
});
