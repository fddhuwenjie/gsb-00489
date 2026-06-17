const { db, initDatabase } = require('./database');
const bcrypt = require('bcryptjs');

function seedDatabase() {
  console.log('开始填充种子数据...');
  
  initDatabase();

  const users = [
    { username: 'admin', password: 'admin123', display_name: '管理员', weight: 1 },
    { username: 'zhangsan', password: '123456', display_name: '张三', weight: 1 },
    { username: 'lisi', password: '123456', display_name: '李四', weight: 1 },
    { username: 'wangwu', password: '123456', display_name: '王五', weight: 1.5 },
    { username: 'zhaoliu', password: '123456', display_name: '赵六', weight: 1 },
    { username: 'qianqi', password: '123456', display_name: '钱七', weight: 2 },
    { username: 'sunba', password: '123456', display_name: '孙八', weight: 1 },
    { username: 'zhoujiu', password: '123456', display_name: '周九', weight: 0.5 }
  ];

  const userStmt = db.prepare(`
    INSERT OR IGNORE INTO users (username, password, display_name, weight)
    VALUES (?, ?, ?, ?)
  `);

  users.forEach(u => {
    const hashed = bcrypt.hashSync(u.password, 10);
    userStmt.run(u.username, hashed, u.display_name, u.weight);
  });

  console.log('✅ 用户数据已创建');

  const adminId = db.prepare('SELECT id FROM users WHERE username = ?').get('admin').id;
  const userIds = db.prepare('SELECT id, username FROM users ORDER BY id').all();

  const polls = [
    {
      title: '2024年度最佳编程语言评选',
      description: '请投票选出您认为2024年度最受欢迎、最实用的编程语言。',
      type: 'single',
      status: 'ended',
      is_anonymous: 0,
      allow_abstain: 1,
      require_supermajority: 0,
      weighted_voting: 0,
      total_rounds: 1,
      current_round: 1,
      deadline: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      options: ['JavaScript', 'Python', 'TypeScript', 'Go', 'Rust', 'Java'],
      creator_id: adminId
    },
    {
      title: '公司团建活动方案排序',
      description: '请对以下团建活动方案进行排序，第1名为您最推荐的方案。',
      type: 'ranked',
      status: 'active',
      is_anonymous: 1,
      allow_abstain: 0,
      require_supermajority: 0,
      weighted_voting: 0,
      total_rounds: 1,
      current_round: 1,
      deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      options: ['户外拓展训练', '温泉度假', '主题乐园', '密室逃脱', '烧烤野餐'],
      creator_id: adminId
    },
    {
      title: '新产品功能满意度评分',
      description: '请对我们即将推出的新功能进行评分（0-10分），您的反馈对我们非常重要。',
      type: 'score',
      status: 'active',
      is_anonymous: 1,
      allow_abstain: 1,
      require_supermajority: 0,
      weighted_voting: 0,
      total_rounds: 1,
      current_round: 1,
      deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      options: ['界面设计', '功能实用性', '性能表现', '用户体验', '创新性'],
      creator_id: adminId
    }
  ];

  const pollStmt = db.prepare(`
    INSERT INTO polls (title, description, type, creator_id, is_anonymous, allow_abstain, deadline, status, current_round, total_rounds, require_supermajority, weighted_voting)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const optionStmt = db.prepare(`
    INSERT INTO options (poll_id, text, option_order)
    VALUES (?, ?, ?)
  `);

  const inviteStmt = db.prepare(`
    INSERT INTO invitations (poll_id, user_id, status)
    VALUES (?, ?, 'invited')
  `);

  const pollIds = [];

  polls.forEach(poll => {
    const result = pollStmt.run(
      poll.title, poll.description, poll.type, poll.creator_id,
      poll.is_anonymous, poll.allow_abstain, poll.deadline,
      poll.status, poll.current_round, poll.total_rounds,
      poll.require_supermajority, poll.weighted_voting
    );
    const pollId = result.lastInsertRowid;
    pollIds.push(pollId);

    poll.options.forEach((opt, idx) => {
      optionStmt.run(pollId, opt, idx);
    });

    userIds.forEach(user => {
      inviteStmt.run(pollId, user.id);
    });
  });

  console.log('✅ 投票数据已创建');

  const voteStmt = db.prepare(`
    INSERT INTO votes (poll_id, user_id, round, vote_data, is_abstain, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const auditStmt = db.prepare(`
    INSERT INTO audit_logs (poll_id, user_id, action, details)
    VALUES (?, ?, ?, ?)
  `);

  const singlePollId = pollIds[0];
  const singleOptions = db.prepare('SELECT * FROM options WHERE poll_id = ? ORDER BY id').all(singlePollId);
  
  const singleVotes = [
    { user: 'zhangsan', optIndex: 0 },
    { user: 'lisi', optIndex: 0 },
    { user: 'wangwu', optIndex: 1 },
    { user: 'zhaoliu', optIndex: 2 },
    { user: 'qianqi', optIndex: 0 },
    { user: 'sunba', optIndex: 4 },
    { user: 'zhoujiu', optIndex: 1 },
    { user: 'admin', optIndex: 2 }
  ];

  singleVotes.forEach(vote => {
    const user = userIds.find(u => u.username === vote.user);
    const option = singleOptions[vote.optIndex];
    const voteTime = new Date(Date.now() - Math.random() * 5 * 24 * 60 * 60 * 1000).toISOString();
    
    voteStmt.run(
      singlePollId, user.id, 1,
      JSON.stringify({ option_id: option.id }),
      0, voteTime
    );

    auditStmt.run(
      singlePollId, user.id, 'submit_vote',
      JSON.stringify({ option: option.text })
    );
  });

  console.log('✅ 单选投票数据已创建');

  const rankedPollId = pollIds[1];
  const rankedOptions = db.prepare('SELECT * FROM options WHERE poll_id = ? ORDER BY id').all(rankedPollId);

  const rankedVotes = [
    { user: 'zhangsan', ranking: [0, 2, 1, 3, 4] },
    { user: 'lisi', ranking: [1, 0, 3, 2, 4] },
    { user: 'wangwu', ranking: [2, 0, 1, 4, 3] },
    { user: 'zhaoliu', ranking: [0, 1, 2, 3, 4] },
    { user: 'qianqi', ranking: [3, 2, 0, 1, 4] }
  ];

  rankedVotes.forEach(vote => {
    const user = userIds.find(u => u.username === vote.user);
    const ranking = vote.ranking.map(idx => rankedOptions[idx].id);
    const voteTime = new Date(Date.now() - Math.random() * 2 * 24 * 60 * 60 * 1000).toISOString();
    
    voteStmt.run(
      rankedPollId, user.id, 1,
      JSON.stringify({ ranking }),
      0, voteTime
    );

    auditStmt.run(
      rankedPollId, user.id, 'submit_vote',
      JSON.stringify({ ranking_count: ranking.length })
    );
  });

  console.log('✅ 排序投票数据已创建');

  const scorePollId = pollIds[2];
  const scoreOptions = db.prepare('SELECT * FROM options WHERE poll_id = ? ORDER BY id').all(scorePollId);

  const scoreVotes = [
    { user: 'zhangsan', scores: [8, 7, 6, 9, 8] },
    { user: 'lisi', scores: [7, 8, 7, 8, 6] },
    { user: 'wangwu', scores: [9, 9, 8, 7, 9] }
  ];

  scoreVotes.forEach(vote => {
    const user = userIds.find(u => u.username === vote.user);
    const scores = {};
    scoreOptions.forEach((opt, idx) => {
      scores[opt.id] = vote.scores[idx];
    });
    const voteTime = new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000).toISOString();
    
    voteStmt.run(
      scorePollId, user.id, 1,
      JSON.stringify({ scores }),
      0, voteTime
    );

    auditStmt.run(
      scorePollId, user.id, 'submit_vote',
      JSON.stringify({ options_count: Object.keys(scores).length })
    );
  });

  console.log('✅ 评分投票数据已创建');

  auditStmt.run(singlePollId, adminId, 'create_poll', JSON.stringify({ title: polls[0].title, type: 'single' }));
  auditStmt.run(rankedPollId, adminId, 'create_poll', JSON.stringify({ title: polls[1].title, type: 'ranked' }));
  auditStmt.run(scorePollId, adminId, 'create_poll', JSON.stringify({ title: polls[2].title, type: 'score' }));

  auditStmt.run(singlePollId, adminId, 'end_poll', null);

  console.log('✅ 审计日志已创建');
  console.log('\n🎉 种子数据填充完成！');
  console.log('\n📋 预置账号：');
  console.log('   管理员 - admin / admin123');
  console.log('   普通用户 - zhangsan / 123456');
  console.log('   普通用户 - lisi / 123456');
  console.log('   (还有5个其他用户，密码均为123456)');
  console.log('\n📊 预置投票：');
  console.log('   1. 2024年度最佳编程语言评选（单选，已结束，8人已投）');
  console.log('   2. 公司团建活动方案排序（排序，进行中，5人已投）');
  console.log('   3. 新产品功能满意度评分（评分，进行中，3人已投）');
}

seedDatabase();
