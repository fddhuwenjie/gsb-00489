const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const { db, initDatabase } = require('./database');
const {
  calculateResults,
  findCondorcetWinner,
  findSmithSet,
  analyzeStability,
  checkSupermajority,
  analyzeTrend,
  calculateScoreMatrix,
  calculateSankeyFlow
} = require('./voting-algorithms');

const app = express();
const PORT = 8489;
const JWT_SECRET = 'voting-app-secret-key-2024';

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

initDatabase();

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: '未授权访问' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token无效' });
    req.user = user;
    next();
  });
}

function addAuditLog(pollId, userId, action, details = null) {
  const stmt = db.prepare(`
    INSERT INTO audit_logs (poll_id, user_id, action, details)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(pollId, userId, action, details ? JSON.stringify(details) : null);
}

app.post('/api/auth/register', (req, res) => {
  const { username, password, display_name } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码必填' });
  }

  try {
    const hashedPassword = bcrypt.hashSync(password, 10);
    const stmt = db.prepare(`
      INSERT INTO users (username, password, display_name)
      VALUES (?, ?, ?)
    `);
    const result = stmt.run(username, hashedPassword, display_name || username);
    
    const token = jwt.sign(
      { id: result.lastInsertRowid, username, display_name: display_name || username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({ token, user: { id: result.lastInsertRowid, username, display_name: display_name || username } });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      res.status(400).json({ error: '用户名已存在' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码必填' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, display_name: user.display_name },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      weight: user.weight
    }
  });
});

app.get('/api/users', authenticateToken, (req, res) => {
  const users = db.prepare('SELECT id, username, display_name, weight FROM users ORDER BY id').all();
  res.json(users);
});

app.post('/api/polls', authenticateToken, (req, res) => {
  const {
    title, description, type, options, deadline,
    is_anonymous, allow_abstain, total_rounds,
    require_supermajority, weighted_voting, invited_users
  } = req.body;

  if (!title || !type || !options || options.length < 2 || options.length > 10) {
    return res.status(400).json({ error: '标题、类型必填，选项需2-10个' });
  }

  const validTypes = ['single', 'multiple', 'ranked', 'score', 'weighted'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: '无效的投票类型' });
  }

  const transaction = db.transaction(() => {
    const pollStmt = db.prepare(`
      INSERT INTO polls (title, description, type, creator_id, is_anonymous, allow_abstain, deadline, status, total_rounds, require_supermajority, weighted_voting)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `);
    const pollResult = pollStmt.run(
      title, description || '', type, req.user.id,
      is_anonymous ? 1 : 0, allow_abstain ? 1 : 0,
      deadline || null, total_rounds || 1,
      require_supermajority ? 1 : 0, weighted_voting ? 1 : 0
    );

    const pollId = pollResult.lastInsertRowid;
    const optionStmt = db.prepare(`
      INSERT INTO options (poll_id, text, option_order)
      VALUES (?, ?, ?)
    `);
    options.forEach((opt, index) => {
      optionStmt.run(pollId, opt, index);
    });

    if (invited_users && invited_users.length > 0) {
      const inviteStmt = db.prepare(`
        INSERT OR IGNORE INTO invitations (poll_id, user_id, status)
        VALUES (?, ?, 'invited')
      `);
      invited_users.forEach(userId => {
        inviteStmt.run(pollId, userId);
      });
    }

    addAuditLog(pollId, req.user.id, 'create_poll', { title, type });

    return pollId;
  });

  try {
    const pollId = transaction();
    res.json({ id: pollId, message: '投票创建成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/polls', authenticateToken, (req, res) => {
  const { status } = req.query;
  
  let query = `
    SELECT p.*, u.display_name as creator_name,
      (SELECT COUNT(*) FROM invitations i WHERE i.poll_id = p.id) as total_invited,
      (SELECT COUNT(DISTINCT v.user_id) FROM votes v WHERE v.poll_id = p.id AND v.round = p.current_round) as total_voted
    FROM polls p
    LEFT JOIN users u ON p.creator_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    if (status === 'active') {
      query += ' AND p.status = "active" AND (p.deadline IS NULL OR p.deadline > datetime("now"))';
    } else if (status === 'ended') {
      query += ' AND (p.status = "ended" OR p.deadline < datetime("now"))';
    } else if (status === 'draft') {
      query += ' AND p.status = "draft"';
    }
  }

  query += ' ORDER BY p.created_at DESC';

  const polls = db.prepare(query).all(...params);
  
  polls.forEach(poll => {
    poll.options = db.prepare('SELECT * FROM options WHERE poll_id = ? ORDER BY option_order').all(poll.id);
    poll.is_creator = poll.creator_id === req.user.id;
    
    const userVote = db.prepare('SELECT * FROM votes WHERE poll_id = ? AND user_id = ? AND round = ?').get(poll.id, req.user.id, poll.current_round);
    poll.has_voted = !!userVote;
    poll.user_vote = userVote ? JSON.parse(userVote.vote_data) : null;
  });

  res.json(polls);
});

app.get('/api/polls/:id', authenticateToken, (req, res) => {
  const pollId = req.params.id;
  
  const poll = db.prepare(`
    SELECT p.*, u.display_name as creator_name
    FROM polls p
    LEFT JOIN users u ON p.creator_id = u.id
    WHERE p.id = ?
  `).get(pollId);

  if (!poll) {
    return res.status(404).json({ error: '投票不存在' });
  }

  poll.options = db.prepare('SELECT * FROM options WHERE poll_id = ? ORDER BY option_order').all(pollId);
  poll.is_creator = poll.creator_id === req.user.id;
  
  const invitations = db.prepare(`
    SELECT i.*, u.username, u.display_name
    FROM invitations i
    JOIN users u ON i.user_id = u.id
    WHERE i.poll_id = ?
  `).all(pollId);
  poll.invitations = invitations;

  const userVote = db.prepare('SELECT * FROM votes WHERE poll_id = ? AND user_id = ? AND round = ?').get(pollId, req.user.id, poll.current_round);
  poll.has_voted = !!userVote;
  poll.user_vote = userVote ? { data: JSON.parse(userVote.vote_data), is_abstain: !!userVote.is_abstain, updated_at: userVote.updated_at } : null;

  const votedUsers = db.prepare(`
    SELECT DISTINCT v.user_id, u.display_name, u.username
    FROM votes v
    JOIN users u ON v.user_id = u.id
    WHERE v.poll_id = ? AND v.round = ?
  `).all(pollId, poll.current_round);
  poll.voted_users = votedUsers;
  poll.total_invited = invitations.length;
  poll.total_voted = votedUsers.length;

  res.json(poll);
});

app.post('/api/polls/:id/vote', authenticateToken, (req, res) => {
  const pollId = req.params.id;
  const { vote_data, is_abstain } = req.body;

  const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  if (!poll) {
    return res.status(404).json({ error: '投票不存在' });
  }

  if (poll.status !== 'active') {
    return res.status(400).json({ error: '投票未激活' });
  }

  if (poll.deadline && new Date(poll.deadline) < new Date()) {
    return res.status(400).json({ error: '投票已截止' });
  }

  const invitation = db.prepare('SELECT * FROM invitations WHERE poll_id = ? AND user_id = ?').get(pollId, req.user.id);
  if (!invitation && poll.creator_id !== req.user.id) {
    return res.status(403).json({ error: '您未被邀请参与此投票' });
  }

  if (!is_abstain && !vote_data) {
    return res.status(400).json({ error: '投票数据不能为空' });
  }

  if (is_abstain && !poll.allow_abstain) {
    return res.status(400).json({ error: '此投票不允许弃权' });
  }

  const existingVote = db.prepare('SELECT * FROM votes WHERE poll_id = ? AND user_id = ? AND round = ?').get(pollId, req.user.id, poll.current_round);

  try {
    if (existingVote) {
      const stmt = db.prepare(`
        UPDATE votes
        SET vote_data = ?, is_abstain = ?, updated_at = CURRENT_TIMESTAMP
        WHERE poll_id = ? AND user_id = ? AND round = ?
      `);
      stmt.run(
        is_abstain ? JSON.stringify({}) : JSON.stringify(vote_data),
        is_abstain ? 1 : 0,
        pollId, req.user.id, poll.current_round
      );
      addAuditLog(pollId, req.user.id, 'update_vote', { round: poll.current_round });
    } else {
      const stmt = db.prepare(`
        INSERT INTO votes (poll_id, user_id, round, vote_data, is_abstain)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(
        pollId, req.user.id, poll.current_round,
        is_abstain ? JSON.stringify({}) : JSON.stringify(vote_data),
        is_abstain ? 1 : 0
      );
      addAuditLog(pollId, req.user.id, 'submit_vote', { round: poll.current_round });
    }

    res.json({ message: existingVote ? '投票已更新' : '投票成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/polls/:id/vote', authenticateToken, (req, res) => {
  const pollId = req.params.id;

  const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  if (!poll) {
    return res.status(404).json({ error: '投票不存在' });
  }

  if (poll.deadline && new Date(poll.deadline) < new Date()) {
    return res.status(400).json({ error: '投票已截止，无法撤回' });
  }

  const existingVote = db.prepare('SELECT * FROM votes WHERE poll_id = ? AND user_id = ? AND round = ?').get(pollId, req.user.id, poll.current_round);
  if (!existingVote) {
    return res.status(400).json({ error: '您尚未投票' });
  }

  const stmt = db.prepare('DELETE FROM votes WHERE poll_id = ? AND user_id = ? AND round = ?');
  stmt.run(pollId, req.user.id, poll.current_round);

  addAuditLog(pollId, req.user.id, 'withdraw_vote', { round: poll.current_round });

  res.json({ message: '投票已撤回' });
});

app.get('/api/polls/:id/results', authenticateToken, (req, res) => {
  const pollId = req.params.id;
  const { round } = req.query;

  const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  if (!poll) {
    return res.status(404).json({ error: '投票不存在' });
  }

  const currentRound = round ? parseInt(round) : poll.current_round;
  const options = db.prepare('SELECT * FROM options WHERE poll_id = ? ORDER BY option_order').all(pollId);
  
  let votes = db.prepare('SELECT * FROM votes WHERE poll_id = ? AND round = ?').all(pollId, currentRound);

  if (poll.weighted_voting) {
    votes = votes.map(vote => {
      const user = db.prepare('SELECT weight FROM users WHERE id = ?').get(vote.user_id);
      return { ...vote, weight: user?.weight || 1 };
    });
  } else {
    votes = votes.map(vote => ({ ...vote, weight: 1 }));
  }

  const results = calculateResults(poll.type, votes, options.filter(o => !o.eliminated));

  let supermajority = null;
  if (poll.require_supermajority) {
    supermajority = checkSupermajority(results.results, results.totalVotes, 2/3);
  }

  let condorcet = null;
  let smithSet = null;
  let stability = null;

  if (votes.length > 0) {
    try {
      condorcet = findCondorcetWinner(votes, options.filter(o => !o.eliminated));
      smithSet = findSmithSet(votes, options.filter(o => !o.eliminated));
      stability = analyzeStability(votes, options.filter(o => !o.eliminated), poll.type);
    } catch (e) {
    }
  }

  let individualVotes = [];
  if (!poll.is_anonymous || poll.creator_id === req.user.id) {
    individualVotes = db.prepare(`
      SELECT v.*, u.display_name, u.username
      FROM votes v
      JOIN users u ON v.user_id = u.id
      WHERE v.poll_id = ? AND v.round = ?
      ORDER BY v.created_at
    `).all(pollId, currentRound).map(v => ({
      ...v,
      vote_data: JSON.parse(v.vote_data),
      is_abstain: !!v.is_abstain
    }));
  }

  const votedCount = votes.filter(v => !v.is_abstain).length;
  const abstainCount = votes.filter(v => v.is_abstain).length;
  const totalInvited = db.prepare('SELECT COUNT(*) as count FROM invitations WHERE poll_id = ?').get(pollId).count;

  res.json({
    poll: {
      id: poll.id,
      title: poll.title,
      type: poll.type,
      status: poll.status,
      is_anonymous: !!poll.is_anonymous,
      current_round: currentRound,
      total_rounds: poll.total_rounds
    },
    results,
    supermajority,
    advanced_analysis: {
      condorcet,
      smithSet,
      stability
    },
    progress: {
      total_invited: totalInvited,
      total_voted: votedCount,
      total_abstain: abstainCount,
      not_voted: totalInvited - votes.length,
      participation_rate: totalInvited > 0 ? +((votes.length / totalInvited) * 100).toFixed(2) : 0
    },
    individual_votes: poll.is_anonymous ? [] : individualVotes,
    is_anonymous: !!poll.is_anonymous,
    can_see_votes: !poll.is_anonymous || poll.creator_id === req.user.id
  });
});

app.post('/api/polls/:id/invite', authenticateToken, (req, res) => {
  const pollId = req.params.id;
  const { user_ids } = req.body;

  const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  if (!poll) {
    return res.status(404).json({ error: '投票不存在' });
  }

  if (poll.creator_id !== req.user.id) {
    return res.status(403).json({ error: '只有创建者可以邀请用户' });
  }

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO invitations (poll_id, user_id, status)
    VALUES (?, ?, 'invited')
  `);

  let invited = 0;
  user_ids.forEach(userId => {
    const result = stmt.run(pollId, userId);
    if (result.changes > 0) invited++;
  });

  addAuditLog(pollId, req.user.id, 'invite_users', { user_ids, invited_count: invited });

  res.json({ message: `已邀请 ${invited} 位用户`, invited });
});

app.post('/api/polls/:id/next-round', authenticateToken, (req, res) => {
  const pollId = req.params.id;

  const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  if (!poll) {
    return res.status(404).json({ error: '投票不存在' });
  }

  if (poll.creator_id !== req.user.id) {
    return res.status(403).json({ error: '只有创建者可以开始下一轮' });
  }

  if (poll.current_round >= poll.total_rounds) {
    return res.status(400).json({ error: '已达最大轮次' });
  }

  const options = db.prepare('SELECT * FROM options WHERE poll_id = ? AND eliminated = 0 ORDER BY option_order').all(pollId);
  if (options.length <= 2) {
    return res.status(400).json({ error: '剩余选项不足，无法继续淘汰' });
  }

  let votes = db.prepare('SELECT * FROM votes WHERE poll_id = ? AND round = ?').all(pollId, poll.current_round);
  
  if (poll.weighted_voting) {
    votes = votes.map(vote => {
      const user = db.prepare('SELECT weight FROM users WHERE id = ?').get(vote.user_id);
      return { ...vote, weight: user?.weight || 1 };
    });
  }

  const results = calculateResults(poll.type, votes, options);
  const lastOption = results.results[results.results.length - 1];

  const transaction = db.transaction(() => {
    db.prepare('UPDATE options SET eliminated = 1 WHERE poll_id = ? AND id = ?').run(pollId, lastOption.option_id);
    db.prepare('UPDATE polls SET current_round = current_round + 1 WHERE id = ?').run(pollId);
    addAuditLog(pollId, req.user.id, 'next_round', { eliminated_option: lastOption.text, round: poll.current_round + 1 });
  });

  transaction();

  res.json({ message: `第 ${poll.current_round + 1} 轮已开始，淘汰选项：${lastOption.text}` });
});

app.post('/api/polls/:id/end', authenticateToken, (req, res) => {
  const pollId = req.params.id;

  const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  if (!poll) {
    return res.status(404).json({ error: '投票不存在' });
  }

  if (poll.creator_id !== req.user.id) {
    return res.status(403).json({ error: '只有创建者可以结束投票' });
  }

  db.prepare('UPDATE polls SET status = "ended" WHERE id = ?').run(pollId);
  addAuditLog(pollId, req.user.id, 'end_poll');

  res.json({ message: '投票已结束' });
});

app.get('/api/polls/:id/audit-log', authenticateToken, (req, res) => {
  const pollId = req.params.id;

  const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  if (!poll) {
    return res.status(404).json({ error: '投票不存在' });
  }

  if (poll.creator_id !== req.user.id) {
    return res.status(403).json({ error: '只有管理员可查看审计日志' });
  }

  const logs = db.prepare(`
    SELECT al.*, u.username, u.display_name
    FROM audit_logs al
    JOIN users u ON al.user_id = u.id
    WHERE al.poll_id = ?
    ORDER BY al.created_at DESC
  `).all(pollId);

  res.json(logs.map(log => ({
    ...log,
    details: log.details ? JSON.parse(log.details) : null
  })));
});

app.get('/api/polls/:id/export', authenticateToken, (req, res) => {
  const pollId = req.params.id;

  const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  if (!poll) {
    return res.status(404).json({ error: '投票不存在' });
  }

  if (poll.creator_id !== req.user.id) {
    return res.status(403).json({ error: '只有管理员可导出结果' });
  }

  const options = db.prepare('SELECT * FROM options WHERE poll_id = ? ORDER BY option_order').all(pollId);
  let votes = db.prepare('SELECT * FROM votes WHERE poll_id = ? AND round = ?').all(pollId, poll.current_round);
  
  if (poll.weighted_voting) {
    votes = votes.map(vote => {
      const user = db.prepare('SELECT weight FROM users WHERE id = ?').get(vote.user_id);
      return { ...vote, weight: user?.weight || 1 };
    });
  }

  const results = calculateResults(poll.type, votes, options.filter(o => !o.eliminated));
  
  let condorcet = null;
  let smithSet = null;
  let stability = null;
  
  if (votes.length > 0) {
    condorcet = findCondorcetWinner(votes, options.filter(o => !o.eliminated));
    smithSet = findSmithSet(votes, options.filter(o => !o.eliminated));
    stability = analyzeStability(votes, options.filter(o => !o.eliminated), poll.type);
  }

  const individualVotes = db.prepare(`
    SELECT v.*, u.display_name, u.username
    FROM votes v
    JOIN users u ON v.user_id = u.id
    WHERE v.poll_id = ? AND v.round = ?
    ORDER BY v.created_at
  `).all(pollId, poll.current_round);

  const typeNames = {
    single: '单选投票 (简单多数制)',
    multiple: '多选投票 (批准投票)',
    ranked: '排序投票 (Borda计数法)',
    score: '评分投票 (0-10分均值)',
    weighted: '权重分配 (100分分配)'
  };

  const resultsHtml = results.results.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${r.text}</td>
      <td>${r.score}${r.percentage !== undefined ? ` (${r.percentage}%)` : ''}</td>
    </tr>
  `).join('');

  const votesHtml = individualVotes.map(v => {
    const data = JSON.parse(v.vote_data);
    let voteText = '';
    if (v.is_abstain) voteText = '弃权';
    else if (data.option_id) {
      const opt = options.find(o => o.id === data.option_id);
      voteText = opt?.text || '未知';
    } else if (data.option_ids) {
      voteText = data.option_ids.map(id => options.find(o => o.id === id)?.text).join(', ');
    } else if (data.ranking) {
      voteText = data.ranking.map((id, i) => `${i + 1}. ${options.find(o => o.id === id)?.text}`).join(' → ');
    } else if (data.scores) {
      voteText = Object.entries(data.scores).map(([id, score]) => `${options.find(o => o.id === parseInt(id))?.text}: ${score}分`).join(', ');
    } else if (data.allocations) {
      voteText = Object.entries(data.allocations).map(([id, amt]) => `${options.find(o => o.id === parseInt(id))?.text}: ${amt}分`).join(', ');
    }
    return `<tr><td>${v.display_name}</td><td>${voteText}</td><td>${v.created_at}</td></tr>`;
  }).join('');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>投票结果 - ${poll.title}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }
    h1 { color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
    h2 { color: #555; margin-top: 30px; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
    th { background: #007bff; color: white; }
    tr:nth-child(even) { background: #f9f9f9; }
    .winner { background: #d4edda !important; font-weight: bold; }
    .info-box { background: #e9ecef; padding: 15px; border-radius: 5px; margin: 10px 0; }
    .bar-chart { display: flex; flex-direction: column; gap: 8px; margin: 15px 0; }
    .bar-item { display: flex; align-items: center; gap: 10px; }
    .bar-label { width: 150px; text-align: right; font-size: 14px; }
    .bar { height: 24px; background: #007bff; border-radius: 4px; min-width: 2px; transition: width 0.3s; }
    .bar-value { font-size: 14px; min-width: 80px; }
  </style>
</head>
<body>
  <h1>${poll.title}</h1>
  <p>${poll.description || ''}</p>
  
  <div class="info-box">
    <strong>投票类型：</strong>${typeNames[poll.type]}<br>
    <strong>状态：</strong>${poll.status === 'active' ? '进行中' : '已结束'}<br>
    <strong>创建者：</strong>${db.prepare('SELECT display_name FROM users WHERE id = ?').get(poll.creator_id)?.display_name}<br>
    <strong>当前轮次：</strong>第 ${poll.current_round} 轮 / 共 ${poll.total_rounds} 轮<br>
    <strong>参与人数：</strong>${votes.length} 人
  </div>

  <h2>投票结果</h2>
  <div class="bar-chart">
    ${results.results.map(r => {
      const maxScore = Math.max(...results.results.map(x => x.score), 1);
      const width = (r.score / maxScore) * 400;
      return `<div class="bar-item">
        <span class="bar-label">${r.text}</span>
        <div class="bar" style="width: ${width}px"></div>
        <span class="bar-value">${r.score}${r.percentage !== undefined ? ` (${r.percentage}%)` : ''}</span>
      </div>`;
    }).join('')}
  </div>

  <table>
    <tr><th>排名</th><th>选项</th><th>得分</th></tr>
    ${resultsHtml}
  </table>

  ${condorcet ? `
  <h2>高级分析</h2>
  <div class="info-box">
    <strong>Condorcet赢家：</strong>${condorcet.hasWinner ? condorcet.winnerText : '不存在'}<br>
    <strong>Smith集：</strong>${smithSet?.smithSetTexts?.join(', ') || 'N/A'} (${smithSet?.size || 0}个选项)<br>
    <strong>结果稳定性：</strong>${stability?.stable ? '稳定' : '不稳定'} (${stability?.pivotalVoterCount || 0}位关键投票者)
  </div>
  ` : ''}

  ${!poll.is_anonymous ? `
  <h2>详细投票记录</h2>
  <table>
    <tr><th>投票者</th><th>投票内容</th><th>投票时间</th></tr>
    ${votesHtml}
  </table>
  ` : '<p><em>此投票为匿名投票，不显示个人投票记录。</em></p>'}

  <p style="margin-top: 40px; color: #999; font-size: 12px;">
    导出时间：${new Date().toLocaleString('zh-CN')}
  </p>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="poll-${pollId}-results.html"`);
  res.send(html);
});

app.post('/api/polls/:id/proxy', authenticateToken, (req, res) => {
  const pollId = req.params.id;
  const { proxy_user_id } = req.body;

  const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  if (!poll) {
    return res.status(404).json({ error: '投票不存在' });
  }

  if (poll.deadline && new Date(poll.deadline) < new Date()) {
    return res.status(400).json({ error: '投票已截止' });
  }

  const invitation = db.prepare('SELECT * FROM invitations WHERE poll_id = ? AND user_id = ?').get(pollId, req.user.id);
  if (!invitation && poll.creator_id !== req.user.id) {
    return res.status(403).json({ error: '您未被邀请参与此投票' });
  }

  const proxyInvitation = db.prepare('SELECT * FROM invitations WHERE poll_id = ? AND user_id = ?').get(pollId, proxy_user_id);
  if (!proxyInvitation && poll.creator_id !== proxy_user_id) {
    return res.status(400).json({ error: '代理用户未被邀请参与此投票' });
  }

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO proxies (poll_id, delegator_id, proxy_user_id)
    VALUES (?, ?, ?)
  `);
  stmt.run(pollId, req.user.id, proxy_user_id);

  addAuditLog(pollId, req.user.id, 'set_proxy', { proxy_user_id });

  res.json({ message: '代理设置成功' });
});

app.get('/api/polls/:id/proxy', authenticateToken, (req, res) => {
  const pollId = req.params.id;

  const proxies = db.prepare(`
    SELECT p.*, u.display_name as proxy_name, u.username as proxy_username
    FROM proxies p
    JOIN users u ON p.proxy_user_id = u.id
    WHERE p.poll_id = ? AND p.delegator_id = ?
  `).all(pollId, req.user.id);

  res.json(proxies);
});

function ensureUserSettings(userId) {
  const existing = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
  if (!existing) {
    db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(userId);
  }
}

app.get('/api/user/settings', authenticateToken, (req, res) => {
  ensureUserSettings(req.user.id);
  const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.id);
  res.json(settings);
});

app.put('/api/user/settings', authenticateToken, (req, res) => {
  ensureUserSettings(req.user.id);
  const { notify_before_end, notify_before_start, notify_result_ready, notify_new_invite } = req.body;
  db.prepare(`
    UPDATE user_settings SET
      notify_before_end = ?,
      notify_before_start = ?,
      notify_result_ready = ?,
      notify_new_invite = ?
    WHERE user_id = ?
  `).run(
    notify_before_end ? 1 : 0,
    notify_before_start ? 1 : 0,
    notify_result_ready ? 1 : 0,
    notify_new_invite ? 1 : 0,
    req.user.id
  );
  res.json({ message: '设置已保存' });
});

app.get('/api/notifications', authenticateToken, (req, res) => {
  const { limit = 20, offset = 0 } = req.query;
  const notifications = db.prepare(`
    SELECT n.*, p.title as poll_title
    FROM notifications n
    LEFT JOIN polls p ON n.poll_id = p.id
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC
    LIMIT ? OFFSET ?
  `).all(req.user.id, parseInt(limit), parseInt(offset));
  const unreadCount = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id).count;
  res.json({ notifications, unreadCount });
});

app.put('/api/notifications/:id/read', authenticateToken, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ message: '已标记为已读' });
});

app.put('/api/notifications/read-all', authenticateToken, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ message: '已全部标记为已读' });
});

app.post('/api/templates', authenticateToken, (req, res) => {
  const { name, description, poll_type, options, rules, is_public } = req.body;
  if (!name || !poll_type || !options || options.length < 2) {
    return res.status(400).json({ error: '名称、类型、至少2个选项必填' });
  }
  try {
    const stmt = db.prepare(`
      INSERT INTO poll_templates (name, description, poll_type, options_json, rules_json, creator_id, is_public)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      name, description || '', poll_type,
      JSON.stringify(options),
      JSON.stringify(rules || {}),
      req.user.id, is_public ? 1 : 0
    );
    res.json({ id: result.lastInsertRowid, message: '模板创建成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/templates/from-poll/:pollId', authenticateToken, (req, res) => {
  const pollId = req.params.pollId;
  const { name, description, is_public } = req.body;
  const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  if (!poll) return res.status(404).json({ error: '投票不存在' });
  if (poll.creator_id !== req.user.id) return res.status(403).json({ error: '只有创建者可以保存为模板' });

  const options = db.prepare('SELECT text FROM options WHERE poll_id = ? ORDER BY option_order').all(pollId).map(o => o.text);
  const rules = {
    is_anonymous: !!poll.is_anonymous,
    allow_abstain: !!poll.allow_abstain,
    require_supermajority: !!poll.require_supermajority,
    weighted_voting: !!poll.weighted_voting,
    total_rounds: poll.total_rounds
  };

  try {
    const stmt = db.prepare(`
      INSERT INTO poll_templates (name, description, poll_type, options_json, rules_json, creator_id, is_public)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      name || poll.title,
      description || poll.description || '',
      poll.type,
      JSON.stringify(options),
      JSON.stringify(rules),
      req.user.id,
      is_public ? 1 : 0
    );
    res.json({ id: result.lastInsertRowid, message: '模板已保存' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/templates', authenticateToken, (req, res) => {
  const { scope = 'mine' } = req.query;
  let templates;
  if (scope === 'public') {
    templates = db.prepare(`
      SELECT t.*, u.display_name as creator_name
      FROM poll_templates t
      LEFT JOIN users u ON t.creator_id = u.id
      WHERE t.is_public = 1
      ORDER BY t.usage_count DESC, t.created_at DESC
    `).all();
  } else {
    templates = db.prepare(`
      SELECT t.*, u.display_name as creator_name
      FROM poll_templates t
      LEFT JOIN users u ON t.creator_id = u.id
      WHERE t.creator_id = ?
      ORDER BY t.created_at DESC
    `).all(req.user.id);
  }
  templates.forEach(t => {
    t.options = JSON.parse(t.options_json);
    t.rules = JSON.parse(t.rules_json);
    t.is_owner = t.creator_id === req.user.id;
  });
  res.json(templates);
});

app.get('/api/templates/:id', authenticateToken, (req, res) => {
  const tpl = db.prepare('SELECT * FROM poll_templates WHERE id = ?').get(req.params.id);
  if (!tpl) return res.status(404).json({ error: '模板不存在' });
  if (!tpl.is_public && tpl.creator_id !== req.user.id) {
    return res.status(403).json({ error: '无权访问此模板' });
  }
  tpl.options = JSON.parse(tpl.options_json);
  tpl.rules = JSON.parse(tpl.rules_json);
  res.json(tpl);
});

app.put('/api/templates/:id', authenticateToken, (req, res) => {
  const tpl = db.prepare('SELECT * FROM poll_templates WHERE id = ?').get(req.params.id);
  if (!tpl) return res.status(404).json({ error: '模板不存在' });
  if (tpl.creator_id !== req.user.id) return res.status(403).json({ error: '只有创建者可以修改' });

  const { name, description, options, rules, is_public } = req.body;
  try {
    db.prepare(`
      UPDATE poll_templates SET
        name = ?, description = ?, options_json = ?, rules_json = ?, is_public = ?
      WHERE id = ?
    `).run(
      name || tpl.name,
      description !== undefined ? description : tpl.description,
      options ? JSON.stringify(options) : tpl.options_json,
      rules ? JSON.stringify(rules) : tpl.rules_json,
      is_public !== undefined ? (is_public ? 1 : 0) : tpl.is_public,
      req.params.id
    );
    res.json({ message: '模板已更新' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/templates/:id', authenticateToken, (req, res) => {
  const tpl = db.prepare('SELECT * FROM poll_templates WHERE id = ?').get(req.params.id);
  if (!tpl) return res.status(404).json({ error: '模板不存在' });
  if (tpl.creator_id !== req.user.id) return res.status(403).json({ error: '只有创建者可以删除' });
  db.prepare('DELETE FROM poll_templates WHERE id = ?').run(req.params.id);
  res.json({ message: '模板已删除' });
});

app.post('/api/templates/:id/clone', authenticateToken, (req, res) => {
  const tpl = db.prepare('SELECT * FROM poll_templates WHERE id = ?').get(req.params.id);
  if (!tpl) return res.status(404).json({ error: '模板不存在' });
  if (!tpl.is_public && tpl.creator_id !== req.user.id) {
    return res.status(403).json({ error: '无权克隆此模板' });
  }
  try {
    const stmt = db.prepare(`
      INSERT INTO poll_templates (name, description, poll_type, options_json, rules_json, creator_id, is_public, usage_count)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0)
    `);
    const result = stmt.run(
      `${tpl.name} (副本)`,
      tpl.description,
      tpl.poll_type,
      tpl.options_json,
      tpl.rules_json,
      req.user.id
    );
    db.prepare('UPDATE poll_templates SET usage_count = usage_count + 1 WHERE id = ?').run(req.params.id);
    res.json({ id: result.lastInsertRowid, message: '模板已克隆到我的模板' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/groups', authenticateToken, (req, res) => {
  const { name, description, global_deadline } = req.body;
  if (!name) return res.status(400).json({ error: '议程名称必填' });
  try {
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as max FROM poll_groups WHERE creator_id = ?').get(req.user.id).max;
    const result = db.prepare(`
      INSERT INTO poll_groups (name, description, creator_id, global_deadline, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, description || '', req.user.id, global_deadline || null, maxOrder + 1);
    res.json({ id: result.lastInsertRowid, message: '议程已创建' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/groups', authenticateToken, (req, res) => {
  const groups = db.prepare(`
    SELECT g.*, u.display_name as creator_name,
      (SELECT COUNT(*) FROM poll_group_items gi WHERE gi.group_id = g.id) as poll_count
    FROM poll_groups g
    LEFT JOIN users u ON g.creator_id = u.id
    WHERE g.creator_id = ?
    ORDER BY g.sort_order, g.created_at DESC
  `).all(req.user.id);

  groups.forEach(g => {
    const items = db.prepare(`
      SELECT gi.*, p.title, p.status, p.deadline, p.current_round, p.total_rounds
      FROM poll_group_items gi
      JOIN polls p ON gi.poll_id = p.id
      WHERE gi.group_id = ?
      ORDER BY gi.item_order
    `).all(g.id);
    g.items = items;

    let completed = 0, active = 0, pending = 0;
    items.forEach((item, idx) => {
      const isEnded = item.status === 'ended' || (item.deadline && new Date(item.deadline) < new Date());
      if (isEnded) completed++;
      else if (idx === 0 || items[idx - 1] && (items[idx - 1].status === 'ended' || (items[idx - 1].deadline && new Date(items[idx - 1].deadline) < new Date()))) active++;
      else pending++;
    });
    g.progress = { completed, active, pending, total: items.length };
  });

  res.json(groups);
});

app.get('/api/groups/:id', authenticateToken, (req, res) => {
  const group = db.prepare('SELECT * FROM poll_groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: '议程不存在' });
  if (group.creator_id !== req.user.id) return res.status(403).json({ error: '无权访问' });

  const items = db.prepare(`
    SELECT gi.*, p.*, u.display_name as creator_name
    FROM poll_group_items gi
    JOIN polls p ON gi.poll_id = p.id
    LEFT JOIN users u ON p.creator_id = u.id
    WHERE gi.group_id = ?
    ORDER BY gi.item_order
  `).all(req.params.id);
  group.items = items;
  res.json(group);
});

app.put('/api/groups/:id', authenticateToken, (req, res) => {
  const group = db.prepare('SELECT * FROM poll_groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: '议程不存在' });
  if (group.creator_id !== req.user.id) return res.status(403).json({ error: '无权修改' });

  const { name, description, global_deadline } = req.body;
  db.prepare(`
    UPDATE poll_groups SET name = ?, description = ?, global_deadline = ? WHERE id = ?
  `).run(name || group.name, description !== undefined ? description : group.description, global_deadline !== undefined ? global_deadline : group.global_deadline, req.params.id);
  res.json({ message: '议程已更新' });
});

app.delete('/api/groups/:id', authenticateToken, (req, res) => {
  const group = db.prepare('SELECT * FROM poll_groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: '议程不存在' });
  if (group.creator_id !== req.user.id) return res.status(403).json({ error: '无权删除' });
  db.prepare('DELETE FROM poll_groups WHERE id = ?').run(req.params.id);
  res.json({ message: '议程已删除' });
});

app.post('/api/groups/:id/items', authenticateToken, (req, res) => {
  const group = db.prepare('SELECT * FROM poll_groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: '议程不存在' });
  if (group.creator_id !== req.user.id) return res.status(403).json({ error: '无权修改' });

  const { poll_id } = req.body;
  const maxOrder = db.prepare('SELECT COALESCE(MAX(item_order), -1) as max FROM poll_group_items WHERE group_id = ?').get(req.params.id).max;
  try {
    db.prepare(`
      INSERT INTO poll_group_items (group_id, poll_id, item_order) VALUES (?, ?, ?)
    `).run(req.params.id, poll_id, maxOrder + 1);
    res.json({ message: '投票已添加到议程' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/groups/:id/reorder', authenticateToken, (req, res) => {
  const group = db.prepare('SELECT * FROM poll_groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: '议程不存在' });
  if (group.creator_id !== req.user.id) return res.status(403).json({ error: '无权修改' });

  const { ordered_poll_ids } = req.body;
  const transaction = db.transaction(() => {
    ordered_poll_ids.forEach((pollId, idx) => {
      db.prepare(`
        UPDATE poll_group_items SET item_order = ? WHERE group_id = ? AND poll_id = ?
      `).run(idx, req.params.id, pollId);
    });
  });
  transaction();
  res.json({ message: '排序已更新' });
});

app.delete('/api/groups/:groupId/items/:pollId', authenticateToken, (req, res) => {
  const group = db.prepare('SELECT * FROM poll_groups WHERE id = ?').get(req.params.groupId);
  if (!group) return res.status(404).json({ error: '议程不存在' });
  if (group.creator_id !== req.user.id) return res.status(403).json({ error: '无权修改' });

  db.prepare('DELETE FROM poll_group_items WHERE group_id = ? AND poll_id = ?').run(req.params.groupId, req.params.pollId);
  res.json({ message: '已从议程中移除' });
});

app.get('/api/groups/:id/export', authenticateToken, (req, res) => {
  const group = db.prepare('SELECT * FROM poll_groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: '议程不存在' });
  if (group.creator_id !== req.user.id) return res.status(403).json({ error: '无权导出' });

  const items = db.prepare(`
    SELECT gi.*, p.* FROM poll_group_items gi
    JOIN polls p ON gi.poll_id = p.id
    WHERE gi.group_id = ? ORDER BY gi.item_order
  `).all(req.params.id);

  let reportsHtml = '';
  items.forEach((poll, idx) => {
    const options = db.prepare('SELECT * FROM options WHERE poll_id = ? ORDER BY option_order').all(poll.id);
    let votes = db.prepare('SELECT * FROM votes WHERE poll_id = ? AND round = ?').all(poll.id, poll.current_round);
    if (poll.weighted_voting) {
      votes = votes.map(v => {
        const u = db.prepare('SELECT weight FROM users WHERE id = ?').get(v.user_id);
        return { ...v, weight: u?.weight || 1 };
      });
    } else {
      votes = votes.map(v => ({ ...v, weight: 1 }));
    }
    const results = calculateResults(poll.type, votes, options.filter(o => !o.eliminated));

    reportsHtml += `
      <div style="margin-top:30px; padding:20px; background:#f9f9f9; border-radius:8px;">
        <h3>#${idx + 1} ${poll.title}</h3>
        <p style="color:#666;">${poll.description || ''}</p>
        <table style="width:100%; border-collapse:collapse; margin-top:12px;">
          <tr><th style="padding:8px; background:#007bff; color:white;">排名</th><th style="padding:8px; background:#007bff; color:white;">选项</th><th style="padding:8px; background:#007bff; color:white;">得分</th></tr>
          ${results.results.map((r, i) => `<tr><td style="padding:8px; border-bottom:1px solid #ddd;">${i + 1}</td><td style="padding:8px; border-bottom:1px solid #ddd;">${r.text}</td><td style="padding:8px; border-bottom:1px solid #ddd;">${r.score}${r.percentage !== undefined ? ` (${r.percentage}%)` : ''}</td></tr>`).join('')}
        </table>
        <p style="margin-top:8px; font-size:13px; color:#888;">参与: ${results.totalVotes} 人</p>
      </div>
    `;
  });

  const html = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>议程汇总报告 - ${group.name}</title>
<style>body{font-family:Arial,sans-serif;max-width:900px;margin:0 auto;padding:20px;} h1{color:#333;border-bottom:2px solid #007bff;padding-bottom:10px;}</style>
</head><body>
<h1>📋 ${group.name}</h1>
<p>${group.description || ''}</p>
<p style="color:#666;">创建时间: ${group.created_at}</p>
${reportsHtml}
<p style="margin-top:40px;color:#999;font-size:12px;">导出时间: ${new Date().toLocaleString('zh-CN')}</p>
</body></html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="group-${req.params.id}-report.html"`);
  res.send(html);
});

app.get('/api/polls/:id/comments', authenticateToken, (req, res) => {
  const { sort = 'time', limit = 20, offset = 0 } = req.query;
  const pollId = req.params.id;

  let orderBy = 'c.is_pinned DESC, c.created_at DESC';
  if (sort === 'hot') orderBy = 'c.is_pinned DESC, c.like_count DESC, c.created_at DESC';

  const comments = db.prepare(`
    SELECT c.*, u.display_name, u.username,
      EXISTS(SELECT 1 FROM comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = ?) as liked
    FROM poll_comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.poll_id = ? AND c.parent_id = 0
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(req.user.id, pollId, parseInt(limit), parseInt(offset));

  const commentIds = comments.map(c => c.id);
  const replies = commentIds.length > 0 ? db.prepare(`
    SELECT c.*, u.display_name, u.username,
      EXISTS(SELECT 1 FROM comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = ?) as liked
    FROM poll_comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.parent_id IN (${commentIds.map(() => '?').join(',')})
    ORDER BY c.created_at ASC
  `).all(req.user.id, ...commentIds) : [];

  const replyMap = {};
  replies.forEach(r => {
    if (!replyMap[r.parent_id]) replyMap[r.parent_id] = [];
    replyMap[r.parent_id].push(r);
  });

  comments.forEach(c => {
    c.replies = replyMap[c.id] || [];
  });

  const total = db.prepare('SELECT COUNT(*) as count FROM poll_comments WHERE poll_id = ? AND parent_id = 0').get(pollId).count;
  res.json({ comments, total, hasMore: offset + comments.length < total });
});

app.post('/api/polls/:id/comments', authenticateToken, (req, res) => {
  const { content, parent_id = 0 } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: '评论内容不能为空' });

  if (parent_id > 0) {
    const parent = db.prepare('SELECT * FROM poll_comments WHERE id = ?').get(parent_id);
    if (!parent) return res.status(400).json({ error: '父评论不存在' });
    if (parent.parent_id > 0) return res.status(400).json({ error: '只支持二级评论' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO poll_comments (poll_id, user_id, content, parent_id)
      VALUES (?, ?, ?, ?)
    `).run(req.params.id, req.user.id, content.trim(), parent_id);
    res.json({ id: result.lastInsertRowid, message: '评论成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/comments/:id/like', authenticateToken, (req, res) => {
  const comment = db.prepare('SELECT * FROM poll_comments WHERE id = ?').get(req.params.id);
  if (!comment) return res.status(404).json({ error: '评论不存在' });

  const existing = db.prepare('SELECT * FROM comment_likes WHERE comment_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (existing) {
    db.prepare('DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?').run(req.params.id, req.user.id);
    db.prepare('UPDATE poll_comments SET like_count = like_count - 1 WHERE id = ?').run(req.params.id);
    res.json({ liked: false, like_count: comment.like_count - 1 });
  } else {
    db.prepare('INSERT INTO comment_likes (comment_id, user_id) VALUES (?, ?)').run(req.params.id, req.user.id);
    db.prepare('UPDATE poll_comments SET like_count = like_count + 1 WHERE id = ?').run(req.params.id);
    res.json({ liked: true, like_count: comment.like_count + 1 });
  }
});

app.put('/api/comments/:id/pin', authenticateToken, (req, res) => {
  const comment = db.prepare(`
    SELECT c.*, p.creator_id FROM poll_comments c
    JOIN polls p ON c.poll_id = p.id
    WHERE c.id = ?
  `).get(req.params.id);
  if (!comment) return res.status(404).json({ error: '评论不存在' });
  if (comment.creator_id !== req.user.id) return res.status(403).json({ error: '只有管理员可置顶' });

  const newPin = comment.is_pinned ? 0 : 1;
  db.prepare('UPDATE poll_comments SET is_pinned = ? WHERE id = ?').run(newPin, req.params.id);
  res.json({ is_pinned: !!newPin, message: newPin ? '已置顶' : '已取消置顶' });
});

app.delete('/api/comments/:id', authenticateToken, (req, res) => {
  const comment = db.prepare(`
    SELECT c.*, p.creator_id as poll_creator FROM poll_comments c
    JOIN polls p ON c.poll_id = p.id
    WHERE c.id = ?
  `).get(req.params.id);
  if (!comment) return res.status(404).json({ error: '评论不存在' });
  if (comment.user_id !== req.user.id && comment.poll_creator !== req.user.id) {
    return res.status(403).json({ error: '无权删除' });
  }
  db.prepare('DELETE FROM poll_comments WHERE id = ? OR parent_id = ?').run(req.params.id, req.params.id);
  res.json({ message: '评论已删除' });
});

app.post('/api/polls/:id/reminders', authenticateToken, (req, res) => {
  const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(req.params.id);
  if (!poll) return res.status(404).json({ error: '投票不存在' });
  if (poll.creator_id !== req.user.id) return res.status(403).json({ error: '只有创建者可设置提醒' });

  const { reminder_type, reminder_time } = req.body;
  const validTypes = ['before_end', 'before_start', 'custom'];
  if (!validTypes.includes(reminder_type)) return res.status(400).json({ error: '无效提醒类型' });

  try {
    db.prepare(`
      INSERT INTO poll_reminders (poll_id, reminder_time, reminder_type) VALUES (?, ?, ?)
    `).run(req.params.id, reminder_time, reminder_type);
    res.json({ message: '提醒已设置' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/polls/:id/visualization/heatmap', authenticateToken, (req, res) => {
  const pollId = req.params.id;
  const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  if (!poll) return res.status(404).json({ error: '投票不存在' });

  const options = db.prepare('SELECT * FROM options WHERE poll_id = ? ORDER BY option_order').all(pollId);
  let votes = db.prepare('SELECT * FROM votes WHERE poll_id = ? AND round = ?').all(pollId, poll.current_round);
  const voters = db.prepare(`
    SELECT DISTINCT u.id, u.display_name, u.username
    FROM votes v JOIN users u ON v.user_id = u.id
    WHERE v.poll_id = ? AND v.round = ?
  `).all(pollId, poll.current_round);

  const heatmap = calculateScoreMatrix(poll, votes, options, voters);
  res.json(heatmap);
});

app.get('/api/polls/:id/visualization/sankey', authenticateToken, (req, res) => {
  const pollId = req.params.id;
  const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  if (!poll) return res.status(404).json({ error: '投票不存在' });

  const options = db.prepare('SELECT * FROM options WHERE poll_id = ? ORDER BY option_order').all(pollId);
  const multiRoundVotes = [];

  for (let r = 1; r <= poll.current_round; r++) {
    let votes = db.prepare('SELECT * FROM votes WHERE poll_id = ? AND round = ?').all(pollId, r);
    if (poll.weighted_voting) {
      votes = votes.map(v => {
        const u = db.prepare('SELECT weight FROM users WHERE id = ?').get(v.user_id);
        return { ...v, weight: u?.weight || 1 };
      });
    } else {
      votes = votes.map(v => ({ ...v, weight: 1 }));
    }
    multiRoundVotes.push(votes);
  }

  const sankey = calculateSankeyFlow(multiRoundVotes, options);
  res.json(sankey);
});

app.get('/api/polls/:id/visualization/radar', authenticateToken, (req, res) => {
  const pollId = req.params.id;
  const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  if (!poll) return res.status(404).json({ error: '投票不存在' });

  const options = db.prepare('SELECT * FROM options WHERE poll_id = ? ORDER BY option_order').all(pollId);
  let votes = db.prepare('SELECT * FROM votes WHERE poll_id = ? AND round = ?').all(pollId, poll.current_round);
  if (poll.weighted_voting) {
    votes = votes.map(v => {
      const u = db.prepare('SELECT weight FROM users WHERE id = ?').get(v.user_id);
      return { ...v, weight: u?.weight || 1 };
    });
  } else {
    votes = votes.map(v => ({ ...v, weight: 1 }));
  }

  const results = calculateResults(poll.type, votes, options.filter(o => !o.eliminated));

  const radarData = {
    labels: options.map(o => o.text),
    datasets: [{
      label: '得分',
      data: options.map(opt => {
        const r = results.results.find(x => x.option_id === opt.id);
        return r ? r.score : 0;
      })
    }]
  };

  if (poll.type === 'score') {
    radarData.dimensions = ['平均分', '最高分比例', '参与率', '标准差', '稳定性'];
    radarData.datasets = options.map(opt => {
      const optVotes = [];
      votes.forEach(v => {
        if (v.is_abstain) return;
        const vd = JSON.parse(v.vote_data);
        if (vd.scores && vd.scores[opt.id] !== undefined) {
          optVotes.push(vd.scores[opt.id]);
        }
      });
      const avg = optVotes.length > 0 ? optVotes.reduce((a, b) => a + b, 0) / optVotes.length : 0;
      const highRate = optVotes.length > 0 ? (optVotes.filter(s => s >= 8).length / optVotes.length) * 100 : 0;
      const participation = votes.length > 0 ? (optVotes.length / votes.filter(v => !v.is_abstain).length) * 100 : 0;
      const variance = optVotes.length > 0 ? optVotes.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / optVotes.length : 0;
      const stdDev = Math.sqrt(variance);
      const stability = stdDev > 0 ? Math.max(0, 100 - stdDev * 10) : 100;
      return {
        label: opt.text,
        data: [+avg.toFixed(2), +highRate.toFixed(2), +participation.toFixed(2), +stdDev.toFixed(2), +stability.toFixed(2)]
      };
    });
  }

  res.json(radarData);
});

app.post('/api/polls/compare', authenticateToken, (req, res) => {
  const { poll_ids } = req.body;
  if (!poll_ids || poll_ids.length < 2) {
    return res.status(400).json({ error: '至少选择2个投票进行对比' });
  }

  const pollResultsList = [];
  const pollInfo = [];

  for (const pid of poll_ids) {
    const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pid);
    if (!poll) continue;
    const options = db.prepare('SELECT * FROM options WHERE poll_id = ? ORDER BY option_order').all(pid);
    let votes = db.prepare('SELECT * FROM votes WHERE poll_id = ? AND round = ?').all(pid, poll.current_round);
    if (poll.weighted_voting) {
      votes = votes.map(v => {
        const u = db.prepare('SELECT weight FROM users WHERE id = ?').get(v.user_id);
        return { ...v, weight: u?.weight || 1 };
      });
    } else {
      votes = votes.map(v => ({ ...v, weight: 1 }));
    }
    const results = calculateResults(poll.type, votes, options.filter(o => !o.eliminated));
    pollResultsList.push({
      poll_id: pid,
      title: poll.title,
      timestamp: poll.created_at,
      type: poll.type,
      results: results.results
    });
    pollInfo.push({ id: poll.id, title: poll.title, type: poll.type, created_at: poll.created_at });
  }

  if (pollResultsList.length < 2) {
    return res.status(400).json({ error: '有效投票不足2个' });
  }

  const trend = analyzeTrend(pollResultsList);
  res.json({ polls: pollInfo, trend });
});

function checkReminders() {
  const now = new Date().toISOString();

  const dueReminders = db.prepare(`
    SELECT pr.*, p.title, p.deadline FROM poll_reminders pr
    JOIN polls p ON pr.poll_id = p.id
    WHERE pr.is_sent = 0 AND pr.reminder_time <= ?
  `).all(now);

  dueReminders.forEach(reminder => {
    const invitedUsers = db.prepare('SELECT user_id FROM invitations WHERE poll_id = ?').all(reminder.poll_id);
    const votedUsers = db.prepare('SELECT DISTINCT user_id FROM votes WHERE poll_id = ?').all(reminder.poll_id).map(v => v.user_id);
    const notVotedUsers = invitedUsers.filter(u => !votedUsers.includes(u.user_id));

    notVotedUsers.forEach(u => {
      const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(u.user_id) || {};
      if (reminder.reminder_type === 'before_end' && settings.notify_before_end === 0) return;
      if (reminder.reminder_type === 'before_start' && settings.notify_before_start === 0) return;

      db.prepare(`
        INSERT INTO notifications (user_id, poll_id, type, title, content)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        u.user_id,
        reminder.poll_id,
        reminder.reminder_type,
        `投票提醒：${reminder.title}`,
        reminder.reminder_type === 'before_end' ? '该投票即将截止，请尽快完成投票！' : '投票即将开始，请留意！'
      );
    });

    db.prepare('UPDATE poll_reminders SET is_sent = 1 WHERE id = ?').run(reminder.id);
  });

  const polls = db.prepare(`
    SELECT p.* FROM polls p
    WHERE p.status = 'active' AND p.deadline IS NOT NULL
    AND p.deadline > ? AND p.deadline <= datetime('now', '+30 minutes')
  `).all(now);

  polls.forEach(poll => {
    const reminderExists = db.prepare(`
      SELECT 1 FROM poll_reminders WHERE poll_id = ? AND reminder_type = 'before_end_30'
    `).get(poll.id);
    if (reminderExists) return;

    db.prepare(`
      INSERT INTO poll_reminders (poll_id, reminder_time, reminder_type, is_sent)
      VALUES (?, datetime('now'), 'before_end_30', 0)
    `).run(poll.id);
  });
}

setInterval(checkReminders, 60 * 1000);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});

module.exports = app;
