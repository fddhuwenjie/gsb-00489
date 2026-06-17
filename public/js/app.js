const API_BASE = 'http://localhost:8489/api';

const app = {
  token: localStorage.getItem('voting_token') || '',
  user: JSON.parse(localStorage.getItem('voting_user') || 'null'),
  currentPage: 'login',
  currentPollId: null,
  currentGroupId: null,
  previousPage: 'home',
  optionCount: 2,
  allUsers: [],
  polls: [],
  templates: [],
  groups: [],
  currentFilter: 'all',
  currentTemplateTab: 'mine',
  comments: [],
  commentsSort: 'time',
  commentsOffset: 0,
  commentsHasMore: true,
  notifications: [],
  notificationInterval: null,

  init() {
    if (this.token && this.user) {
      this.showPage('home');
      this.loadPolls();
      this.loadNotifications();
      this.startNotificationPolling();
    } else {
      this.showPage('login');
    }
    this.updateUserDisplay();
  },

  showPage(page) {
    this.currentPage = page;

    const pageIds = [
      'login-page', 'home-page', 'create-page', 'poll-page', 'results-page',
      'templates-page', 'groups-page', 'group-detail-page', 'compare-page', 'settings-page'
    ];
    pageIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });

    document.getElementById('header').classList.add('hidden');

    if (page === 'login') {
      document.getElementById('login-page').classList.remove('hidden');
    } else {
      document.getElementById('header').classList.remove('hidden');
      const targetEl = document.getElementById(`${page}-page`);
      if (targetEl) targetEl.classList.remove('hidden');

      document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.page === page) btn.classList.add('active');
      });
    }
  },

  navigate(page) {
    switch (page) {
      case 'home':
        this.showPage('home');
        this.loadPolls();
        break;
      case 'create':
        this.showPage('create');
        this.initCreateForm();
        break;
      case 'templates':
        this.showPage('templates');
        this.loadTemplates();
        break;
      case 'groups':
        this.showPage('groups');
        this.loadGroups();
        break;
      case 'compare':
        this.showPage('compare');
        this.loadComparePolls();
        break;
      case 'settings':
        this.showPage('settings');
        this.loadSettings();
        break;
      case 'poll':
        this.showPage('poll');
        break;
    }
  },

  updateUserDisplay() {
    const el = document.getElementById('userDisplay');
    if (this.user && el) {
      el.textContent = this.user.display_name || this.user.username;
    }
  },

  switchAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.auth-tab:nth-child(${tab === 'login' ? '1' : '2'})`).classList.add('active');

    document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
    document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
    document.getElementById('auth-error').classList.add('hidden');
  },

  async handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (res.ok) {
        this.token = data.token;
        this.user = data.user;
        localStorage.setItem('voting_token', data.token);
        localStorage.setItem('voting_user', JSON.stringify(data.user));
        this.updateUserDisplay();
        this.showPage('home');
        this.loadPolls();
        this.loadNotifications();
        this.startNotificationPolling();
        this.showToast('登录成功', 'success');
      } else {
        this.showAuthError(data.error);
      }
    } catch (err) {
      this.showAuthError('网络错误');
    }
  },

  async handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById('register-username').value;
    const password = document.getElementById('register-password').value;
    const displayName = document.getElementById('register-displayname').value;

    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, display_name: displayName })
      });

      const data = await res.json();

      if (res.ok) {
        this.token = data.token;
        this.user = data.user;
        localStorage.setItem('voting_token', data.token);
        localStorage.setItem('voting_user', JSON.stringify(data.user));
        this.updateUserDisplay();
        this.showPage('home');
        this.loadPolls();
        this.loadNotifications();
        this.startNotificationPolling();
        this.showToast('注册成功', 'success');
      } else {
        this.showAuthError(data.error);
      }
    } catch (err) {
      this.showAuthError('网络错误');
    }
  },

  showAuthError(msg) {
    const el = document.getElementById('auth-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  },

  logout() {
    this.token = '';
    this.user = null;
    localStorage.removeItem('voting_token');
    localStorage.removeItem('voting_user');
    if (this.notificationInterval) {
      clearInterval(this.notificationInterval);
      this.notificationInterval = null;
    }
    this.showPage('login');
  },

  async request(url, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${API_BASE}${url}`, {
      ...options,
      headers
    });

    if (res.status === 401) {
      this.logout();
      throw new Error('未授权');
    }

    return res;
  },

  async loadPolls() {
    try {
      const res = await this.request('/polls');
      const data = await res.json();
      this.polls = data;
      this.renderPolls();
    } catch (err) {
      console.error('加载投票失败', err);
    }
  },

  filterPolls(filter) {
    this.currentFilter = filter;
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    this.renderPolls();
  },

  renderPolls() {
    const container = document.getElementById('polls-list');
    if (!container) return;

    let filtered = this.polls;
    if (this.currentFilter === 'active') {
      filtered = this.polls.filter(p => p.status === 'active' && (!p.deadline || new Date(p.deadline) > new Date()));
    } else if (this.currentFilter === 'ended') {
      filtered = this.polls.filter(p => p.status === 'ended' || (p.deadline && new Date(p.deadline) < new Date()));
    }

    if (filtered.length === 0) {
      container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #999;">暂无投票</div>';
      return;
    }

    const typeNames = {
      single: '单选',
      multiple: '多选',
      ranked: '排序',
      score: '评分',
      weighted: '权重分配'
    };

    container.innerHTML = filtered.map(poll => {
      let statusText = poll.status === 'active' ? '进行中' : (poll.status === 'ended' ? '已结束' : '草稿');
      let statusClass = poll.status === 'active' ? 'status-active' : (poll.status === 'ended' ? 'status-ended' : 'status-draft');

      if (poll.status === 'active' && poll.deadline && new Date(poll.deadline) < new Date()) {
        statusText = '已结束';
        statusClass = 'status-ended';
      }

      return `
        <div class="poll-card" onclick="app.viewPoll(${poll.id})">
          <div class="poll-card-header">
            <div class="poll-card-title">${poll.title}</div>
            <span class="poll-status ${statusClass}">${statusText}</span>
          </div>
          <p class="poll-card-desc">${poll.description || '暂无描述'}</p>
          <div class="poll-card-meta">
            <span class="poll-type-badge">${typeNames[poll.type] || poll.type}</span>
            <span>👥 ${poll.total_voted}/${poll.total_invited}人</span>
            <span>📋 ${poll.options.length}个选项</span>
          </div>
          ${poll.has_voted ? '<div style="margin-top:12px; color: #00a854; font-size: 13px;">✓ 已投票</div>' : ''}
        </div>
      `;
    }).join('');
  },

  async viewPoll(pollId) {
    this.currentPollId = pollId;
    this.showPage('poll');
    this.commentsOffset = 0;
    this.commentsHasMore = true;
    this.comments = [];
    await this.loadPollDetail();
  },

  async loadPollDetail() {
    try {
      const res = await this.request(`/polls/${this.currentPollId}`);
      const poll = await res.json();
      this.renderPollDetail(poll);
      this.loadComments();
    } catch (err) {
      console.error('加载投票详情失败', err);
    }
  },

  renderPollDetail(poll) {
    const container = document.getElementById('poll-detail');
    if (!container) return;

    const typeNames = {
      single: '单选投票（简单多数制）',
      multiple: '多选投票（批准投票）',
      ranked: '排序投票（Borda计数法）',
      score: '评分投票（0-10分均值）',
      weighted: '权重分配（100分分配）'
    };

    let statusText = poll.status === 'active' ? '进行中' : (poll.status === 'ended' ? '已结束' : '草稿');
    let statusClass = poll.status === 'active' ? 'status-active' : (poll.status === 'ended' ? 'status-ended' : 'status-draft');

    if (poll.status === 'active' && poll.deadline && new Date(poll.deadline) < new Date()) {
      statusText = '已结束';
      statusClass = 'status-ended';
    }

    const isEnded = poll.status === 'ended' || (poll.deadline && new Date(poll.deadline) < new Date());
    const canVote = !isEnded && poll.status === 'active';
    const isCreator = poll.is_creator;

    let votingSection = '';

    if (canVote && !poll.has_voted) {
      votingSection = this.renderVotingForm(poll);
    } else if (canVote && poll.has_voted) {
      votingSection = this.renderVotedSection(poll);
    }

    const discussionLabel = isEnded ? '投后讨论' : '讨论区';

    container.innerHTML = `
      <div class="poll-detail-container">
        <div class="poll-detail-header">
          <h2>${poll.title}</h2>
          <p class="poll-detail-desc">${poll.description || '暂无描述'}</p>
          <div class="poll-detail-info">
            <span class="poll-status ${statusClass}">${statusText}</span>
            <span>📊 ${typeNames[poll.type]}</span>
            <span>👤 创建者：${poll.creator_name}</span>
            ${poll.deadline ? `<span>⏰ 截止：${new Date(poll.deadline).toLocaleString('zh-CN')}</span>` : ''}
            ${poll.is_anonymous ? '<span>🕶️ 匿名投票</span>' : ''}
            ${poll.allow_abstain ? '<span>✋ 允许弃权</span>' : ''}
            ${poll.total_rounds > 1 ? `<span>🔄 第 ${poll.current_round} 轮 / 共 ${poll.total_rounds} 轮</span>` : ''}
            ${poll.weighted_voting ? '<span>⚖️ 加权投票</span>' : ''}
          </div>
        </div>
        <div class="poll-detail-body">
          ${isCreator ? `
            <div class="admin-actions">
              <button class="btn btn-outline btn-sm" onclick="app.viewResults()">📊 查看结果</button>
              <button class="btn btn-outline btn-sm" onclick="app.exportResults()">📥 导出结果</button>
              <button class="btn btn-outline btn-sm" onclick="app.savePollAsTemplate()">💾 保存为模板</button>
              ${poll.total_rounds > 1 && !isEnded ? '<button class="btn btn-outline btn-sm" onclick="app.nextRound()">⏭️ 下一轮</button>' : ''}
              ${!isEnded ? '<button class="btn btn-danger btn-sm" onclick="app.endPoll()">🔚 结束投票</button>' : ''}
              <button class="btn btn-outline btn-sm" onclick="app.viewAuditLog()">📋 审计日志</button>
            </div>
          ` : ''}

          ${votingSection}

          ${isEnded ? `
            <div class="results-section">
              <h3>投票结果</h3>
              <button class="btn btn-outline btn-sm" onclick="app.viewResults()">📊 查看详细结果</button>
            </div>
          ` : ''}

          <div class="comments-section">
            <div class="comments-header">
              <h3>💬 ${discussionLabel}</h3>
              <div class="comments-sort">
                <button class="btn btn-outline btn-xs ${this.commentsSort === 'time' ? 'active' : ''}" onclick="app.switchCommentsSort('time')">最新</button>
                <button class="btn btn-outline btn-xs ${this.commentsSort === 'hot' ? 'active' : ''}" onclick="app.switchCommentsSort('hot')">最热</button>
              </div>
            </div>
            <div class="comment-input-area">
              <textarea id="comment-input" placeholder="发表评论..." rows="3"></textarea>
              <div class="comment-actions">
                <button class="btn btn-primary btn-sm" onclick="app.submitComment()">发表评论</button>
              </div>
            </div>
            <div id="comments-list"></div>
            <div id="comments-load-more" class="comments-load-more" style="display:none;">
              <button class="btn btn-outline btn-sm" onclick="app.loadMoreComments()">加载更多</button>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  renderVotingForm(poll) {
    const activeOptions = poll.options.filter(o => !o.eliminated);

    let optionsHtml = '';

    switch (poll.type) {
      case 'single':
        optionsHtml = `
          <div class="single-option-list">
            ${activeOptions.map(opt => `
              <label class="vote-option-item" onclick="this.querySelector('input').checked = true; app.updateSingleVote()">
              <input type="radio" name="vote-option" value="${opt.id}" onchange="app.updateSingleVote()">
              <span>${opt.text}</span>
            </label>
            `).join('')}
          </div>
        `;
        break;

      case 'multiple':
        optionsHtml = `
          <div class="multiple-option-list">
            ${activeOptions.map(opt => `
              <label class="vote-option-item">
                <input type="checkbox" value="${opt.id}" onchange="app.updateMultipleVote()">
                <span>${opt.text}</span>
              </label>
            `).join('')}
          </div>
        `;
        break;

      case 'ranked':
        optionsHtml = `
          <div class="rank-option-list" id="rank-list">
            ${activeOptions.map((opt, i) => `
              <div class="rank-option-item" data-id="${opt.id}">
                <div class="rank-number">${i + 1}</div>
                <div class="rank-option-text">${opt.text}</div>
                <div class="rank-buttons">
                  <button class="rank-btn" onclick="app.moveRank(${opt.id}, -1)">↑</button>
                  <button class="rank-btn" onclick="app.moveRank(${opt.id}, 1)">↓</button>
                </div>
              </div>
            `).join('')}
          </div>
          <p style="font-size: 12px; color: #999; margin-top: 8px;">使用上下箭头调整排名，第1名为最佳选项</p>
        `;
        break;

      case 'score':
        optionsHtml = `
          <div class="score-option-list">
            ${activeOptions.map(opt => `
              <div class="score-option-item">
                <div class="score-option-text">${opt.text}</div>
                <input type="range" class="score-slider" id="score-${opt.id}"
                  min="0" max="10" step="1" value="5"
                  oninput="app.updateScore(${opt.id})">
                <div class="score-value" id="score-value-${opt.id}">5</div>
              </div>
            `).join('')}
          </div>
        `;
        break;

      case 'weighted':
        optionsHtml = `
          <div class="weight-option-list">
            ${activeOptions.map((opt, i) => `
              <div class="weight-option-item">
                <div class="weight-option-text">${opt.text}</div>
                <input type="number" class="weight-input" id="weight-${opt.id}"
                  min="0" max="100" value="${Math.floor(100 / activeOptions.length)}"
                  oninput="app.updateWeight()">
                <span class="weight-unit">分</span>
              </div>
            `).join('')}
          </div>
          <div class="weight-total">总计：<strong id="weight-total">100</strong> / 100 分</div>
        `;
        break;
    }

    return `
      <div class="voting-section">
      <h3>请投票</h3>
      ${optionsHtml}
      ${poll.allow_abstain ? `
        <label class="abstain-option" id="abstain-label" onclick="app.toggleAbstain()">
          <input type="checkbox" id="abstain-checkbox" onchange="app.toggleAbstain()">
          <span>弃权</span>
        </label>
      ` : ''}
      <div class="vote-actions">
        <button class="btn btn-primary" onclick="app.submitVote()">提交投票</button>
      </div>
    </div>
    `;
  },

  renderVotedSection(poll) {
    let voteText = '';
    const voteData = poll.user_vote.data;

    if (poll.user_vote.is_abstain) {
      voteText = '您选择了弃权';
    } else {
      switch (poll.type) {
        case 'single':
          const opt = poll.options.find(o => o.id === voteData.option_id);
          voteText = `您的选择：${opt?.text || '未知'}`;
          break;
        case 'multiple':
          const opts = voteData.option_ids.map(id => poll.options.find(o => o.id === id)?.text).join('、');
          voteText = `您的选择：${opts}`;
          break;
        case 'ranked':
          voteText = '您已完成排序投票';
          break;
        case 'score':
          voteText = '您已完成评分投票';
          break;
        case 'weighted':
          voteText = '您已完成权重分配';
          break;
      }
    }

    const canWithdraw = !poll.deadline || new Date(poll.deadline) > new Date();

    return `
      <div class="voting-section">
        <h3>您已投票</h3>
        <p style="color: #00a854; margin-bottom: 12px;">✓ ${voteText}</p>
        <p style="font-size: 13px; color: #888; margin-bottom: 12px;">
          投票时间：${new Date(poll.user_vote.updated_at).toLocaleString('zh-CN')}
        </p>
        <div class="vote-actions">
          ${canWithdraw ? `
            <button class="btn btn-outline" onclick="app.withdrawVote()">撤回投票</button>
          ` : ''}
          <button class="btn btn-primary" onclick="app.viewResults()">查看结果</button>
        </div>
      </div>
    `;
  },

  updateSingleVote() {
    document.querySelectorAll('.vote-option-item').forEach(item => {
      const input = item.querySelector('input');
      item.classList.toggle('selected', input.checked);
    });
  },

  updateMultipleVote() {
    document.querySelectorAll('.vote-option-item').forEach(item => {
      const input = item.querySelector('input');
      item.classList.toggle('selected', input.checked);
    });
  },

  moveRank(optId, direction) {
    const list = document.getElementById('rank-list');
    if (!list) return;
    const items = Array.from(list.children);
    const idx = items.findIndex(item => parseInt(item.dataset.id) === optId);

    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= items.length) return;

    const [movedItem] = items.splice(idx, 1);
    items.splice(newIdx, 0, movedItem);

    list.innerHTML = '';
    items.forEach((item, i) => {
      item.querySelector('.rank-number').textContent = i + 1;
      list.appendChild(item);
    });
  },

  updateScore(optId) {
    const slider = document.getElementById(`score-${optId}`);
    const valueDisplay = document.getElementById(`score-value-${optId}`);
    if (slider && valueDisplay) {
      valueDisplay.textContent = slider.value;
    }
  },

  updateWeight() {
    let total = 0;
    document.querySelectorAll('.weight-input').forEach(input => {
      total += parseInt(input.value) || 0;
    });
    const totalEl = document.getElementById('weight-total');
    if (totalEl) {
      totalEl.textContent = total;
      totalEl.style.color = total === 100 ? '#007bff' : '#ff4d4f';
    }
  },

  toggleAbstain() {
    const checkbox = document.getElementById('abstain-checkbox');
    const label = document.getElementById('abstain-label');
    if (checkbox && label) {
      checkbox.checked = !checkbox.checked;
      label.classList.toggle('selected', checkbox.checked);
    }
  },

  async submitVote() {
    const poll = this.polls.find(p => p.id === this.currentPollId);
    if (!poll) return;

    let voteData = {};
    let isAbstain = false;

    const abstainCheckbox = document.getElementById('abstain-checkbox');
    if (abstainCheckbox && abstainCheckbox.checked) {
      isAbstain = true;
    } else {
      switch (poll.type) {
        case 'single':
          const selected = document.querySelector('input[name="vote-option"]:checked');
          if (!selected) {
            this.showToast('请选择一个选项', 'error');
            return;
          }
          voteData.option_id = parseInt(selected.value);
          break;

        case 'multiple':
          const selectedOptions = Array.from(document.querySelectorAll('.multiple-option-list input:checked'));
          if (selectedOptions.length === 0) {
            this.showToast('请至少选择一个选项', 'error');
            return;
          }
          voteData.option_ids = selectedOptions.map(o => parseInt(o.value));
          break;

        case 'ranked':
          const rankItems = document.querySelectorAll('.rank-option-item');
          voteData.ranking = Array.from(rankItems).map(item => parseInt(item.dataset.id));
          break;

        case 'score':
          voteData.scores = {};
          poll.options.filter(o => !o.eliminated).forEach(opt => {
            const slider = document.getElementById(`score-${opt.id}`);
            if (slider) {
              voteData.scores[opt.id] = parseInt(slider.value);
            }
          });
          break;

        case 'weighted':
          let total = 0;
          voteData.allocations = {};
          poll.options.filter(o => !o.eliminated).forEach(opt => {
            const input = document.getElementById(`weight-${opt.id}`);
            const val = parseInt(input?.value) || 0;
            voteData.allocations[opt.id] = val;
            total += val;
          });
          if (total !== 100) {
            this.showToast('权重总和必须等于100分', 'error');
            return;
          }
          break;
      }
    }

    try {
      const res = await this.request(`/polls/${this.currentPollId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ vote_data: voteData, is_abstain: isAbstain })
      });

      if (res.ok) {
        this.showToast('投票成功', 'success');
        this.loadPollDetail();
        this.loadPolls();
      } else {
        const data = await res.json();
        this.showToast(data.error || '投票失败', 'error');
      }
    } catch (err) {
      this.showToast('网络错误', 'error');
    }
  },

  async withdrawVote() {
    if (!confirm('确定要撤回您的投票吗？')) return;

    try {
      const res = await this.request(`/polls/${this.currentPollId}/vote`, {
        method: 'DELETE'
      });

      if (res.ok) {
        this.showToast('投票已撤回', 'success');
        this.loadPollDetail();
        this.loadPolls();
      } else {
        const data = await res.json();
        this.showToast(data.error || '撤回失败', 'error');
      }
    } catch (err) {
      this.showToast('网络错误', 'error');
    }
  },

  async viewResults() {
    this.previousPage = this.currentPage;
    this.showPage('results');
    await this.loadResults();
  },

  goBackFromResults() {
    this.showPage(this.previousPage);
    if (this.previousPage === 'poll') {
      this.loadPollDetail();
    } else {
      this.loadPolls();
    }
  },

  async loadResults() {
    try {
      const res = await this.request(`/polls/${this.currentPollId}/results`);
      const data = await res.json();
      this.renderResults(data);
      this.loadVisualizations();
    } catch (err) {
      console.error('加载结果失败', err);
    }
  },

  async loadVisualizations() {
    try {
      const [radarRes, sankeyRes, heatmapRes] = await Promise.all([
        this.request(`/polls/${this.currentPollId}/visualization/radar`),
        this.request(`/polls/${this.currentPollId}/visualization/sankey`),
        this.request(`/polls/${this.currentPollId}/visualization/heatmap`)
      ]);

      const radarData = radarRes.ok ? await radarRes.json() : null;
      const sankeyData = sankeyRes.ok ? await sankeyRes.json() : null;
      const heatmapData = heatmapRes.ok ? await heatmapRes.json() : null;

      this.renderVisualizations(radarData, sankeyData, heatmapData);
    } catch (err) {
      console.error('加载可视化数据失败', err);
    }
  },

  renderVisualizations(radarData, sankeyData, heatmapData) {
    const container = document.getElementById('results-content');
    if (!container) return;

    let extraHtml = '';

    if (radarData && radarData.labels && radarData.labels.length > 0) {
      extraHtml += `
        <div class="chart-container" id="radar-chart-container">
          <div class="chart-title-row">
            <div class="chart-title">🕸️ 雷达图</div>
            <button class="btn btn-outline btn-xs" onclick="app.exportChartAsPNG('radar-chart-container', '雷达图')">📷 导出PNG</button>
          </div>
          <div class="chart-wrapper">
            ${this.renderRadarChart(radarData)}
          </div>
        </div>
      `;
    }

    if (sankeyData && sankeyData.links && sankeyData.links.length > 0) {
      extraHtml += `
        <div class="chart-container" id="sankey-chart-container">
          <div class="chart-title-row">
            <div class="chart-title">🌊 桑基图（多轮投票流向）</div>
            <button class="btn btn-outline btn-xs" onclick="app.exportChartAsPNG('sankey-chart-container', '桑基图')">📷 导出PNG</button>
          </div>
          <div class="chart-wrapper">
            ${this.renderSankeyChart(sankeyData)}
          </div>
        </div>
      `;
    }

    if (heatmapData && heatmapData.matrix && heatmapData.matrix.length > 0) {
      extraHtml += `
        <div class="chart-container" id="heatmap-chart-container">
          <div class="chart-title-row">
            <div class="chart-title">🔥 热力图（投票者-选项矩阵）</div>
            <button class="btn btn-outline btn-xs" onclick="app.exportChartAsPNG('heatmap-chart-container', '热力图')">📷 导出PNG</button>
          </div>
          <div class="chart-wrapper">
            ${this.renderHeatmapChart(heatmapData)}
          </div>
        </div>
      `;
    }

    if (extraHtml) {
      container.insertAdjacentHTML('beforeend', extraHtml);
    }
  },

  renderRadarChart(data) {
    const labels = data.labels || [];
    const datasets = data.datasets || [];
    const n = labels.length;
    if (n < 3) return '<p style="color:#999;text-align:center;padding:20px;">雷达图至少需要3个维度</p>';

    const size = 400;
    const cx = size / 2;
    const cy = size / 2;
    const radius = 140;
    const levels = 5;
    const colors = ['#007bff', '#00a854', '#fa8c16', '#722ed1', '#eb2f96', '#13c2c2'];

    const angleStep = (2 * Math.PI) / n;

    let gridSvg = '';
    for (let l = 1; l <= levels; l++) {
      const r = (radius * l) / levels;
      const points = [];
      for (let i = 0; i < n; i++) {
        const angle = i * angleStep - Math.PI / 2;
        points.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
      }
      gridSvg += `<polygon points="${points.join(' ')}" fill="none" stroke="#e0e0e0" stroke-width="1"/>`;
    }

    let axisSvg = '';
    let labelsSvg = '';
    for (let i = 0; i < n; i++) {
      const angle = i * angleStep - Math.PI / 2;
      const x = cx + radius * Math.cos(angle);
      const y = cy + radius * Math.sin(angle);
      axisSvg += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#e0e0e0" stroke-width="1"/>`;

      const labelR = radius + 25;
      const lx = cx + labelR * Math.cos(angle);
      const ly = cy + labelR * Math.sin(angle);
      labelsSvg += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="12" fill="#333">${labels[i]}</text>`;
    }

    let dataSvg = '';
    let legendSvg = '';
    datasets.forEach((ds, idx) => {
      const color = colors[idx % colors.length];
      const maxVal = Math.max(...ds.data, 1);
      const points = [];
      for (let i = 0; i < n; i++) {
        const angle = i * angleStep - Math.PI / 2;
        const val = ds.data[i] || 0;
        const r = (val / maxVal) * radius;
        points.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
      }
      dataSvg += `<polygon points="${points.join(' ')}" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="2"/>`;

      for (let i = 0; i < n; i++) {
        const angle = i * angleStep - Math.PI / 2;
        const val = ds.data[i] || 0;
        const r = (val / maxVal) * radius;
        const px = cx + r * Math.cos(angle);
        const py = cy + r * Math.sin(angle);
        dataSvg += `<circle cx="${px}" cy="${py}" r="4" fill="${color}"/>`;
      }

      legendSvg += `
        <div class="pie-legend-item">
          <div class="pie-legend-color" style="background: ${color}"></div>
          <span>${ds.label} ${ds.data.map(d => d.toFixed(1)).join(', ')}</span>
        </div>
      `;
    });

    return `
      <div style="display:flex;gap:20px;align-items:flex-start;">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          ${gridSvg}
          ${axisSvg}
          ${dataSvg}
          ${labelsSvg}
        </svg>
        <div class="pie-legend">${legendSvg}</div>
      </div>
    `;
  },

  renderSankeyChart(data) {
    const nodes = data.nodes || [];
    const links = data.links || [];
    const roundCount = data.roundCount || 1;

    if (nodes.length === 0) return '<p style="color:#999;text-align:center;padding:20px;">暂无多轮投票数据</p>';

    const width = 700;
    const height = 400;
    const padding = { top: 30, right: 30, bottom: 30, left: 100 };
    const nodeWidth = 20;
    const colors = ['#007bff', '#00a854', '#fa8c16', '#722ed1', '#eb2f96', '#13c2c2', '#faad14', '#f5222d'];

    const rounds = {};
    nodes.forEach(n => {
      if (!rounds[n.round]) rounds[n.round] = [];
      rounds[n.round].push(n);
    });

    const roundKeys = Object.keys(rounds).map(Number).sort((a, b) => a - b);
    const roundGap = (width - padding.left - padding.right - nodeWidth) / Math.max(roundKeys.length - 1, 1);

    const nodePositions = {};
    roundKeys.forEach(r => {
      const roundNodes = rounds[r];
      const totalHeight = height - padding.top - padding.bottom;
      const nodeGap = totalHeight / Math.max(roundNodes.length, 1);
      roundNodes.forEach((n, i) => {
        nodePositions[n.id] = {
          x: padding.left + r * roundGap,
          y: padding.top + i * nodeGap + nodeGap / 4,
          height: nodeGap / 2
        };
      });
    });

    let nodesSvg = '';
    roundKeys.forEach((r, ri) => {
      const roundNodes = rounds[r];
      roundNodes.forEach((n, i) => {
        const pos = nodePositions[n.id];
        const color = colors[i % colors.length];
        nodesSvg += `<rect x="${pos.x}" y="${pos.y}" width="${nodeWidth}" height="${pos.height}" fill="${color}" rx="2"/>`;
        nodesSvg += `<text x="${pos.x - 8}" y="${pos.y + pos.height / 2}" text-anchor="end" dominant-baseline="middle" font-size="11" fill="#333">${n.name}</text>`;
      });
      nodesSvg += `<text x="${padding.left + ri * roundGap + nodeWidth / 2}" y="${padding.top - 10}" text-anchor="middle" font-size="12" fill="#666" font-weight="bold">第${r + 1}轮</text>`;
    });

    let linksSvg = '';
    const maxLinkValue = Math.max(...links.map(l => l.value), 1);
    links.forEach((link, idx) => {
      const sourcePos = nodePositions[link.source];
      const targetPos = nodePositions[link.target];
      if (!sourcePos || !targetPos) return;

      const linkWidth = Math.max(2, (link.value / maxLinkValue) * 15);
      const x1 = sourcePos.x + nodeWidth;
      const y1 = sourcePos.y + sourcePos.height / 2;
      const x2 = targetPos.x;
      const y2 = targetPos.y + targetPos.height / 2;
      const cx1 = x1 + (x2 - x1) / 2;
      const cx2 = x1 + (x2 - x1) / 2;

      const color = colors[idx % colors.length];
      linksSvg += `<path d="M${x1},${y1} C${cx1},${y1} ${cx2},${y2} ${x2},${y2}" fill="none" stroke="${color}" stroke-width="${linkWidth}" stroke-opacity="0.5"/>`;
    });

    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${linksSvg}${nodesSvg}</svg>`;
  },

  renderHeatmapChart(data) {
    const matrix = data.matrix || [];
    const optionLabels = data.optionLabels || [];
    const userLabels = data.userLabels || [];

    if (matrix.length === 0) return '<p style="color:#999;text-align:center;padding:20px;">暂无热力图数据</p>';

    const cellSize = 40;
    const labelSize = 100;
    const width = labelSize + optionLabels.length * cellSize + 20;
    const height = labelSize / 2 + userLabels.length * cellSize + 20;

    let allVals = [];
    matrix.forEach(row => row.forEach(v => { if (v !== null && v !== undefined) allVals.push(v); }));
    const maxVal = Math.max(...allVals, 1);
    const minVal = Math.min(...allVals, 0);

    const getColor = (val) => {
      if (val === null || val === undefined) return '#f5f5f5';
      const t = (val - minVal) / (maxVal - minVal || 1);
      const r = Math.round(255 - t * 200);
      const g = Math.round(255 - t * 100);
      const b = Math.round(255 - t * 50);
      if (t > 0.5) {
        return `rgb(${Math.round(255 - t * 200)}, ${Math.round(150 + t * 105)}, ${Math.round(100 - t * 50)})`;
      }
      return `rgb(${r}, ${g}, ${b})`;
    };

    let cellsSvg = '';
    let yLabelsSvg = '';
    let xLabelsSvg = '';

    userLabels.forEach((user, i) => {
      yLabelsSvg += `<text x="${labelSize - 8}" y="${labelSize / 2 + i * cellSize + cellSize / 2}" text-anchor="end" dominant-baseline="middle" font-size="11" fill="#333">${user}</text>`;
      optionLabels.forEach((opt, j) => {
        const val = matrix[i] ? matrix[i][j] : null;
        const x = labelSize + j * cellSize;
        const y = labelSize / 2 + i * cellSize;
        cellsSvg += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="${getColor(val)}" stroke="#fff" stroke-width="1"/>`;
        if (val !== null && val !== undefined) {
          cellsSvg += `<text x="${x + cellSize / 2}" y="${y + cellSize / 2}" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="${typeof val === 'number' && val > maxVal * 0.5 ? '#fff' : '#333'}">${typeof val === 'number' ? val.toFixed(1) : val}</text>`;
        }
      });
    });

    optionLabels.forEach((opt, j) => {
      xLabelsSvg += `<text x="${labelSize + j * cellSize + cellSize / 2}" y="${15}" text-anchor="middle" font-size="11" fill="#333" transform="rotate(-30, ${labelSize + j * cellSize + cellSize / 2}, 15)">${opt}</text>`;
    });

    return `
      <div style="overflow-x:auto;">
        <svg width="${Math.max(width, 400)}" height="${height}" viewBox="0 0 ${width} ${height}">
          ${xLabelsSvg}
          ${yLabelsSvg}
          ${cellsSvg}
        </svg>
      </div>
    `;
  },

  exportChartAsPNG(containerId, filename) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const svg = container.querySelector('svg');
    if (!svg) {
      this.showToast('未找到图表', 'error');
      return;
    }

    try {
      const svgData = new XMLSerializer().serializeToString(svg);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = 2;
        canvas.width = (svg.getAttribute('width') || 400) * scale;
        canvas.height = (svg.getAttribute('height') || 300) * scale;
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);

        canvas.toBlob((blob) => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `${filename}-${Date.now()}.png`;
          a.click();
          URL.revokeObjectURL(a.href);
          this.showToast('导出成功', 'success');
        }, 'image/png');
      };
      img.onerror = () => {
        this.showToast('导出失败', 'error');
        URL.revokeObjectURL(url);
      };
      img.src = url;
    } catch (err) {
      console.error(err);
      this.showToast('导出失败', 'error');
    }
  },

  renderResults(data) {
    const container = document.getElementById('results-content');
    if (!container) return;
    const results = data.results;
    const maxScore = Math.max(...results.results.map(r => r.score), 1);

    const colors = ['#007bff', '#00a854', '#fa8c16', '#722ed1', '#eb2f96', '#13c2c2', '#faad14', '#f5222d'];

    let supermajorityHtml = '';
    if (data.supermajority) {
      supermajorityHtml = `
        <div class="supermajority-banner ${data.supermajority.passed ? 'passed' : 'failed'}">
          ${data.supermajority.passed ? '✓ ' : '✗ '}
          条件决议：${data.supermajority.passed ? '通过' : '未通过'}
          （需 ${Math.ceil(data.supermajority.totalVotes * data.supermajority.threshold)} 票，
          实际 ${data.supermajority.yesVotes} 票，
          ${data.supermajority.percentage}%）
        </div>
      `;
    }

    let pieChartHtml = '';
    if (results.type !== 'weighted_allocation' && results.results.length > 0) {
      const total = results.results.reduce((sum, r) => sum + r.score, 0);
      let cumulativePercent = 0;
      const pieSlices = results.results.map((r, i) => {
        const percent = total > 0 ? (r.score / total) * 100 : 0;
        const startAngle = cumulativePercent * 3.6;
        cumulativePercent += percent;
        const endAngle = cumulativePercent * 3.6;
        return { ...r, color: colors[i % colors.length], percent, startAngle, endAngle };
      });

      pieChartHtml = `
        <div class="chart-container">
          <div class="chart-title">饼图</div>
          <div class="pie-chart-container">
            <svg class="pie-chart" viewBox="0 0 100 100">
              ${pieSlices.map(slice => {
                if (slice.percent <= 0) return '';
                const startRad = (slice.startAngle - 90) * Math.PI / 180;
                const endRad = (slice.endAngle - 90) * Math.PI / 180;
                const x1 = 50 + 40 * Math.cos(startRad);
                const y1 = 50 + 40 * Math.sin(startRad);
                const x2 = 50 + 40 * Math.cos(endRad);
                const y2 = 50 + 40 * Math.sin(endRad);
                const largeArc = slice.percent > 50 ? 1 : 0;
                return `<path d="M50,50 L${x1},${y1} A40,40 0 ${largeArc},1 ${x2},${y2} Z" fill="${slice.color}" />`;
              }).join('')}
            </svg>
          </div>
          <div class="pie-legend">
            ${pieSlices.map(slice => `
              <div class="pie-legend-item">
                <div class="pie-legend-color" style="background: ${slice.color}"></div>
                <span>${slice.text} (${slice.percent.toFixed(1)}%)</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    const analysis = data.advanced_analysis;
    let analysisHtml = '';
    if (analysis && (analysis.condorcet || analysis.smithSet || analysis.stability)) {
      analysisHtml = `
        <div class="analysis-section">
          <h4>🔬 高级分析</h4>
          ${analysis.condorcet ? `
            <div class="analysis-item">
              <span class="analysis-label">Condorcet赢家</span>
              <span class="analysis-value ${analysis.condorcet.hasWinner ? 'positive' : ''}">
                ${analysis.condorcet.hasWinner ? analysis.condorcet.winnerText : '不存在'}
              </span>
            </div>
          ` : ''}
          ${analysis.smithSet ? `
            <div class="analysis-item">
              <span class="analysis-label">Smith集（${analysis.smithSet.size}个选项）</span>
              <span class="analysis-value">
                ${analysis.smithSet.smithSetTexts?.join('、') || 'N/A'}
              </span>
            </div>
          ` : ''}
          ${analysis.stability ? `
            <div class="analysis-item">
              <span class="analysis-label">结果稳定性</span>
              <span class="analysis-value ${analysis.stability.stable ? 'positive' : 'negative'}">
                ${analysis.stability.stable ? '稳定' : '不稳定'}
                （${analysis.stability.pivotalVoterCount}位关键投票者）
              </span>
            </div>
          ` : ''}
        </div>
      `;
    }

    let votesTableHtml = '';
    if (data.can_see_votes && data.individual_votes && data.individual_votes.length > 0) {
      votesTableHtml = `
        <div class="chart-container">
          <div class="chart-title">📋 投票详情（${data.individual_votes.length}人）</div>
          <table class="votes-table">
            <tr><th>投票者</th><th>投票内容</th><th>时间</th></tr>
            ${data.individual_votes.map(v => {
              let voteText = '';
              if (v.is_abstain) {
                voteText = '弃权';
              } else if (v.vote_data.option_id) {
                const opt = (this.polls.find(p => p.id === this.currentPollId)?.options || []).find(o => o.id === v.vote_data.option_id);
                voteText = opt?.text || '未知';
              } else if (v.vote_data.option_ids) {
                const opts = v.vote_data.option_ids.map(id => {
                  const opt = (this.polls.find(p => p.id === this.currentPollId)?.options || []).find(o => o.id === id);
                  return opt?.text || '未知';
                }).join('、');
                voteText = opts;
              } else if (v.vote_data.ranking) {
                voteText = v.vote_data.ranking.map((id, i) => {
                  const opt = (this.polls.find(p => p.id === this.currentPollId)?.options || []).find(o => o.id === id);
                  return `${i + 1}. ${opt?.text || '未知'}`;
                }).join(' → ');
              } else if (v.vote_data.scores) {
                voteText = Object.entries(v.vote_data.scores).map(([id, score]) => {
                  const opt = (this.polls.find(p => p.id === this.currentPollId)?.options || []).find(o => o.id === parseInt(id));
                  return `${opt?.text || '未知'}: ${score}分`;
                }).join('，');
              } else if (v.vote_data.allocations) {
                voteText = Object.entries(v.vote_data.allocations).map(([id, amt]) => {
                  const opt = (this.polls.find(p => p.id === this.currentPollId)?.options || []).find(o => o.id === parseInt(id));
                  return `${opt?.text || '未知'}: ${amt}分`;
                }).join('，');
              }
              return `<tr><td>${v.display_name}</td><td>${voteText}</td><td>${new Date(v.created_at).toLocaleString('zh-CN')}</td></tr>`;
            }).join('')}
          </table>
        </div>
      `;
    }

    container.innerHTML = `
      <h2 style="font-size: 22px; margin-bottom: 16px;">${data.poll.title} - 投票结果</h2>

      <div class="progress-section">
        <h4>参与进度</h4>
        <div class="progress-bar-container">
          <div class="progress-bar" style="width: ${data.progress.participation_rate}%"></div>
        </div>
        <div class="progress-stats">
          <span>已投票：${data.progress.total_voted}人</span>
          <span>参与率：${data.progress.participation_rate}%</span>
          <span>弃权：${data.progress.total_abstain}人</span>
          <span>未投票：${data.progress.not_voted}人</span>
        </div>
      </div>

      ${supermajorityHtml}

      <div class="chart-container">
        <div class="chart-title">📊 结果排名</div>
        <div class="bar-chart">
          ${results.results.map((r, i) => {
            const width = maxScore > 0 ? (r.score / maxScore) * 100 : 0;
            const isWinner = i === 0;
            return `
              <div class="bar-item">
                <div class="bar-label">${r.text}</div>
                <div class="bar-wrapper">
                  <div class="bar-fill ${isWinner ? 'winner' : ''}" style="width: ${width}%">
                    ${width > 20 ? `<span class="bar-fill-text">${r.score}${r.percentage !== undefined ? ` (${r.percentage}%)` : ''}</span>` : ''}
                  </div>
                </div>
                <div class="bar-value">${r.score}${r.percentage !== undefined ? ` (${r.percentage}%)` : ''}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      ${pieChartHtml}

      <div class="chart-container">
        <div class="chart-title">🏆 排名榜</div>
        <div class="ranking-list">
          ${results.results.map((r, i) => {
            let rankClass = '';
            if (i === 0) rankClass = 'gold';
            else if (i === 1) rankClass = 'silver';
            else if (i === 2) rankClass = 'bronze';
            return `
              <div class="ranking-item">
                <div class="ranking-number ${rankClass}">${i + 1}</div>
                <div class="ranking-text">${r.text}</div>
                <div class="ranking-score">${r.score}${r.percentage !== undefined ? `分 (${r.percentage}%)` : '分'}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      ${analysisHtml}

      ${votesTableHtml}

      ${data.is_anonymous ? '<p style="text-align: center; color: #999; margin-top: 20px;">🕶️ 此投票为匿名投票，不显示个人投票记录</p>' : ''}
    `;
  },

  async exportResults() {
    try {
      const res = await this.request(`/polls/${this.currentPollId}/export`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `poll-${this.currentPollId}-results.html`;
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('导出成功', 'success');
      } else {
        const data = await res.json();
        this.showToast(data.error || '导出失败', 'error');
      }
    } catch (err) {
      this.showToast('网络错误', 'error');
    }
  },

  async nextRound() {
    if (!confirm('确定要开始下一轮投票吗？当前轮次最低的选项将被淘汰。')) return;

    try {
      const res = await this.request(`/polls/${this.currentPollId}/next-round`, {
        method: 'POST'
      });

      if (res.ok) {
        const data = await res.json();
        this.showToast(data.message, 'success');
        this.loadPollDetail();
        this.loadPolls();
      } else {
        const data = await res.json();
        this.showToast(data.error || '操作失败', 'error');
      }
    } catch (err) {
      this.showToast('网络错误', 'error');
    }
  },

  async endPoll() {
    if (!confirm('确定要结束此投票吗？结束后不可再投票。')) return;

    try {
      const res = await this.request(`/polls/${this.currentPollId}/end`, {
        method: 'POST'
      });

      if (res.ok) {
        this.showToast('投票已结束', 'success');
        this.loadPollDetail();
        this.loadPolls();
      } else {
        const data = await res.json();
        this.showToast(data.error || '操作失败', 'error');
      }
    } catch (err) {
      this.showToast('网络错误', 'error');
    }
  },

  async viewAuditLog() {
    try {
      const res = await this.request(`/polls/${this.currentPollId}/audit-log`);
      const logs = await res.json();

      let logsHtml = logs.length === 0
        ? '<p style="color: #999; text-align: center;">暂无审计记录</p>'
        : `<div class="audit-log-list">
            ${logs.map(log => `
              <div class="audit-log-item">
                <div class="audit-log-time">${new Date(log.created_at).toLocaleString('zh-CN')}</div>
                <div class="audit-log-action">${log.display_name} - ${log.action}</div>
                ${log.details ? `<div class="audit-log-details">${JSON.stringify(log.details)}</div>` : ''}
              </div>
            `).join('')}
          </div>`;

      const popup = window.open('', '审计日志', 'width=600,height=500');
      popup.document.write(`
        <html><head><title>审计日志</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          .log-item { padding: 12px; border-bottom: 1px solid #eee; margin-bottom: 8px; }
          .time { color: #999; font-size: 12px; }
          .action { font-weight: bold; margin: 4px 0; }
          .details { color: #666; font-size: 13px; }
        </style></head><body>
        <h2>📋 审计日志</h2>
        ${logsHtml}
        </body></html>
      `);
    } catch (err) {
      this.showToast('加载失败', 'error');
    }
  },

  initCreateForm() {
    this.optionCount = 2;
    this.renderOptions();
    this.loadUsersForInvite();
    this.loadTemplatesForSelect();
  },

  renderOptions() {
    const container = document.getElementById('options-container');
    if (!container) return;
    let html = '';
    for (let i = 0; i < this.optionCount; i++) {
      html += `
        <div class="option-item">
          <input type="text" id="option-${i}" placeholder="选项 ${i + 1}" value="${i === 0 ? '选项A' : i === 1 ? '选项B' : ''}">
          ${this.optionCount > 2 ? `<button type="button" class="remove-option-btn" onclick="app.removeOption(${i})">×</button>` : ''}
        </div>
      `;
    }
    container.innerHTML = html;
  },

  addOption() {
    if (this.optionCount >= 10) {
      this.showToast('最多10个选项', 'error');
      return;
    }
    this.optionCount++;
    this.renderOptions();
  },

  removeOption(index) {
    if (this.optionCount <= 2) return;

    const inputs = [];
    for (let i = 0; i < this.optionCount; i++) {
      const input = document.getElementById(`option-${i}`);
      if (i !== index) {
        inputs.push(input?.value || '');
      }
    }

    this.optionCount--;
    this.renderOptions();

    for (let i = 0; i < this.optionCount; i++) {
      const input = document.getElementById(`option-${i}`);
      if (input && inputs[i]) {
        input.value = inputs[i];
      }
    }
  },

  async loadUsersForInvite() {
    try {
      const res = await this.request('/users');
      this.allUsers = await res.json();
      this.renderUserCheckboxes();
    } catch (err) {
      console.error('加载用户失败', err);
    }
  },

  renderUserCheckboxes() {
    const container = document.getElementById('users-checkbox-list');
    if (!container) return;
    container.innerHTML = this.allUsers
      .filter(u => u.id !== this.user.id)
      .map(user => `
        <label class="user-checkbox-item">
          <input type="checkbox" value="${user.id}" onchange="app.toggleUserCheckbox(this)">
          <span>${user.display_name || user.username}</span>
        </label>
      `).join('');
  },

  toggleUserCheckbox(checkbox) {
    const item = checkbox.closest('.user-checkbox-item');
    if (item) item.classList.toggle('selected', checkbox.checked);
  },

  async handleCreatePoll(e) {
    e.preventDefault();

    const title = document.getElementById('poll-title').value.trim();
    const description = document.getElementById('poll-description').value.trim();
    const type = document.querySelector('input[name="poll-type"]:checked')?.value;
    const deadline = document.getElementById('poll-deadline').value;
    const reminderHours = document.getElementById('poll-reminder-hours')?.value;
    const isAnonymous = document.getElementById('poll-anonymous').checked;
    const allowAbstain = document.getElementById('poll-abstain').checked;
    const supermajority = document.getElementById('poll-supermajority').checked;
    const weighted = document.getElementById('poll-weighted').checked;

    const options = [];
    for (let i = 0; i < this.optionCount; i++) {
      const input = document.getElementById(`option-${i}`);
      const val = input?.value.trim();
      if (val) options.push(val);
    }

    const invitedUsers = Array.from(document.querySelectorAll('#users-checkbox-list input:checked'))
      .map(cb => parseInt(cb.value));

    if (!title) {
      this.showToast('请输入标题', 'error');
      return;
    }
    if (options.length < 2) {
      this.showToast('至少需要2个选项', 'error');
      return;
    }

    try {
      const res = await this.request('/polls', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description,
          type,
          options,
          deadline: deadline || null,
          is_anonymous: isAnonymous,
          allow_abstain: allowAbstain,
          require_supermajority: supermajority,
          weighted_voting: weighted,
          total_rounds: 1,
          invited_users: invitedUsers
        })
      });

      if (res.ok) {
        const data = await res.json();

        if (reminderHours && deadline) {
          const deadlineDate = new Date(deadline);
          const reminderTime = new Date(deadlineDate.getTime() - parseInt(reminderHours) * 60 * 60 * 1000);
          if (reminderTime > new Date()) {
            try {
              await this.request(`/polls/${data.id}/reminders`, {
                method: 'POST',
                body: JSON.stringify({
                  reminder_type: 'before_end',
                  reminder_time: reminderTime.toISOString()
                })
              });
            } catch (e) {
              console.warn('设置提醒失败', e);
            }
          }
        }

        this.showToast('投票创建成功', 'success');
        this.navigate('home');
      } else {
        const data = await res.json();
        this.showToast(data.error || '创建失败', 'error');
      }
    } catch (err) {
      this.showToast('网络错误', 'error');
    }
  },

  showToast(message, type = '') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.remove('hidden');

    setTimeout(() => {
      toast.classList.add('hidden');
    }, 3000);
  },

  showModal(title, contentHtml) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = contentHtml;
    document.getElementById('modal-overlay').classList.remove('hidden');
  },

  closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
  },

  async loadTemplates() {
    try {
      const res = await this.request(`/templates?scope=${this.currentTemplateTab}`);
      this.templates = await res.json();
      this.renderTemplates();
    } catch (err) {
      console.error('加载模板失败', err);
    }
  },

  switchTemplateTab(tab) {
    this.currentTemplateTab = tab;
    document.getElementById('template-tab-mine').classList.toggle('active', tab === 'mine');
    document.getElementById('template-tab-public').classList.toggle('active', tab === 'public');
    this.loadTemplates();
  },

  renderTemplates() {
    const container = document.getElementById('templates-list');
    if (!container) return;

    const typeNames = {
      single: '单选',
      multiple: '多选',
      ranked: '排序',
      score: '评分',
      weighted: '权重分配'
    };

    if (this.templates.length === 0) {
      container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #999;">暂无模板</div>';
      return;
    }

    container.innerHTML = this.templates.map(tpl => `
      <div class="poll-card">
        <div class="poll-card-header">
          <div class="poll-card-title">${tpl.name}</div>
          <span class="poll-type-badge">${typeNames[tpl.poll_type] || tpl.poll_type}</span>
        </div>
        <p class="poll-card-desc">${tpl.description || '暂无描述'}</p>
        <div class="poll-card-meta">
          <span>📋 ${tpl.options?.length || 0}个选项</span>
          ${this.currentTemplateTab === 'public' ? `<span>👤 ${tpl.creator_name}</span>` : ''}
          ${tpl.usage_count ? `<span>📊 使用${tpl.usage_count}次</span>` : ''}
        </div>
        <div style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn-primary btn-sm" onclick="app.useTemplate(${tpl.id})">使用模板</button>
          ${this.currentTemplateTab === 'public' ? `
            <button class="btn btn-outline btn-sm" onclick="app.cloneTemplate(${tpl.id})">克隆</button>
          ` : `
            <button class="btn btn-outline btn-sm" onclick="app.editTemplate(${tpl.id})">编辑</button>
            <button class="btn btn-danger btn-sm" onclick="app.deleteTemplate(${tpl.id})">删除</button>
          `}
        </div>
      </div>
    `).join('');
  },

  showCreateTemplateModal() {
    this.showModal('创建模板', `
      <form onsubmit="app.handleCreateTemplate(event)">
        <div class="form-group">
          <label>模板名称 *</label>
          <input type="text" id="tpl-name" required maxlength="100">
        </div>
        <div class="form-group">
          <label>描述</label>
          <textarea id="tpl-desc" rows="2" maxlength="500"></textarea>
        </div>
        <div class="form-group">
          <label>投票类型</label>
          <select id="tpl-type">
            <option value="single">单选投票</option>
            <option value="multiple">多选投票</option>
            <option value="ranked">排序投票</option>
            <option value="score">评分投票</option>
            <option value="weighted">权重分配</option>
          </select>
        </div>
        <div class="form-group">
          <label>选项（每行一个，至少2个）</label>
          <textarea id="tpl-options" rows="5" placeholder="选项A&#10;选项B"></textarea>
        </div>
        <div class="checkbox-list">
          <label class="checkbox-item">
            <input type="checkbox" id="tpl-anonymous">
            <span>匿名投票</span>
          </label>
          <label class="checkbox-item">
            <input type="checkbox" id="tpl-abstain">
            <span>允许弃权</span>
          </label>
          <label class="checkbox-item">
            <input type="checkbox" id="tpl-public">
            <span>公开为模板市场</span>
          </label>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="app.closeModal()">取消</button>
          <button type="submit" class="btn btn-primary">创建</button>
        </div>
      </form>
    `);
  },

  async handleCreateTemplate(e) {
    e.preventDefault();
    const name = document.getElementById('tpl-name').value.trim();
    const description = document.getElementById('tpl-desc').value.trim();
    const poll_type = document.getElementById('tpl-type').value;
    const optionsText = document.getElementById('tpl-options').value.trim();
    const options = optionsText.split('\n').map(s => s.trim()).filter(s => s);
    const is_public = document.getElementById('tpl-public').checked;

    if (!name || options.length < 2) {
      this.showToast('名称必填，选项至少2个', 'error');
      return;
    }

    const rules = {
      is_anonymous: document.getElementById('tpl-anonymous').checked,
      allow_abstain: document.getElementById('tpl-abstain').checked
    };

    try {
      const res = await this.request('/templates', {
        method: 'POST',
        body: JSON.stringify({ name, description, poll_type, options, rules, is_public })
      });
      if (res.ok) {
        this.showToast('模板创建成功', 'success');
        this.closeModal();
        this.loadTemplates();
      } else {
        const data = await res.json();
        this.showToast(data.error || '创建失败', 'error');
      }
    } catch (err) {
      this.showToast('网络错误', 'error');
    }
  },

  async editTemplate(id) {
    try {
      const res = await this.request(`/templates/${id}`);
      const tpl = await res.json();
      this.showModal('编辑模板', `
        <form onsubmit="app.handleUpdateTemplate(event, ${id})">
          <div class="form-group">
            <label>模板名称 *</label>
            <input type="text" id="tpl-name" value="${tpl.name}" required maxlength="100">
          </div>
          <div class="form-group">
            <label>描述</label>
            <textarea id="tpl-desc" rows="2" maxlength="500">${tpl.description || ''}</textarea>
          </div>
          <div class="form-group">
            <label>选项（每行一个）</label>
            <textarea id="tpl-options" rows="5">${tpl.options?.join('\n') || ''}</textarea>
          </div>
          <div class="checkbox-list">
            <label class="checkbox-item">
              <input type="checkbox" id="tpl-anonymous" ${tpl.rules?.is_anonymous ? 'checked' : ''}>
              <span>匿名投票</span>
            </label>
            <label class="checkbox-item">
              <input type="checkbox" id="tpl-abstain" ${tpl.rules?.allow_abstain ? 'checked' : ''}>
              <span>允许弃权</span>
            </label>
            <label class="checkbox-item">
              <input type="checkbox" id="tpl-public" ${tpl.is_public ? 'checked' : ''}>
              <span>公开为模板市场</span>
            </label>
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn-outline" onclick="app.closeModal()">取消</button>
            <button type="submit" class="btn btn-primary">保存</button>
          </div>
        </form>
      `);
    } catch (err) {
      this.showToast('加载失败', 'error');
    }
  },

  async handleUpdateTemplate(e, id) {
    e.preventDefault();
    const name = document.getElementById('tpl-name').value.trim();
    const description = document.getElementById('tpl-desc').value.trim();
    const optionsText = document.getElementById('tpl-options').value.trim();
    const options = optionsText.split('\n').map(s => s.trim()).filter(s => s);
    const is_public = document.getElementById('tpl-public').checked;

    if (!name || options.length < 2) {
      this.showToast('名称必填，选项至少2个', 'error');
      return;
    }

    const rules = {
      is_anonymous: document.getElementById('tpl-anonymous').checked,
      allow_abstain: document.getElementById('tpl-abstain').checked
    };

    try {
      const res = await this.request(`/templates/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, description, options, rules, is_public })
      });
      if (res.ok) {
        this.showToast('模板已更新', 'success');
        this.closeModal();
        this.loadTemplates();
      } else {
        const data = await res.json();
        this.showToast(data.error || '更新失败', 'error');
      }
    } catch (err) {
      this.showToast('网络错误', 'error');
    }
  },

  async deleteTemplate(id) {
    if (!confirm('确定删除此模板吗？')) return;
    try {
      const res = await this.request(`/templates/${id}`, { method: 'DELETE' });
      if (res.ok) {
        this.showToast('模板已删除', 'success');
        this.loadTemplates();
      } else {
        this.showToast('删除失败', 'error');
      }
    } catch (err) {
      this.showToast('网络错误', 'error');
    }
  },

  async cloneTemplate(id) {
    try {
      const res = await this.request(`/templates/${id}/clone`, { method: 'POST' });
      if (res.ok) {
        this.showToast('模板已克隆到我的模板', 'success');
        this.currentTemplateTab = 'mine';
        document.getElementById('template-tab-mine').classList.add('active');
        document.getElementById('template-tab-public').classList.remove('active');
        this.loadTemplates();
      } else {
        const data = await res.json();
        this.showToast(data.error || '克隆失败', 'error');
      }
    } catch (err) {
      this.showToast('网络错误', 'error');
    }
  },

  async useTemplate(id) {
    try {
      const res = await this.request(`/templates/${id}`);
      const tpl = await res.json();
      this.navigate('create');
      setTimeout(() => this.applyTemplateData(tpl), 100);
    } catch (err) {
      this.showToast('加载模板失败', 'error');
    }
  },

  async loadTemplatesForSelect() {
    try {
      const res = await this.request('/templates?scope=mine');
      const templates = await res.json();
      const select = document.getElementById('template-select');
      if (!select) return;
      select.innerHTML = '<option value="">-- 不使用模板 --</option>' +
        templates.map(t => `<option value="${t.id}">${t.name} (${t.options?.length || 0}个选项)</option>`).join('');
    } catch (err) {
      console.error('加载模板下拉失败', err);
    }
  },

  async applyTemplate() {
    const select = document.getElementById('template-select');
    if (!select || !select.value) return;
    try {
      const res = await this.request(`/templates/${select.value}`);
      const tpl = await res.json();
      this.applyTemplateData(tpl);
      this.showToast('模板已应用', 'success');
    } catch (err) {
      this.showToast('应用模板失败', 'error');
    }
  },

  applyTemplateData(tpl) {
    const typeRadio = document.querySelector(`input[name="poll-type"][value="${tpl.poll_type}"]`);
    if (typeRadio) typeRadio.checked = true;

    if (tpl.rules?.is_anonymous !== undefined) {
      document.getElementById('poll-anonymous').checked = !!tpl.rules.is_anonymous;
    }
    if (tpl.rules?.allow_abstain !== undefined) {
      document.getElementById('poll-abstain').checked = !!tpl.rules.allow_abstain;
    }
    if (tpl.rules?.require_supermajority !== undefined) {
      document.getElementById('poll-supermajority').checked = !!tpl.rules.require_supermajority;
    }
    if (tpl.rules?.weighted_voting !== undefined) {
      document.getElementById('poll-weighted').checked = !!tpl.rules.weighted_voting;
    }

    if (tpl.options && tpl.options.length > 0) {
      this.optionCount = tpl.options.length;
      this.renderOptions();
      tpl.options.forEach((opt, i) => {
        const input = document.getElementById(`option-${i}`);
        if (input) input.value = opt;
      });
    }
  },

  async savePollAsTemplate() {
    this.showModal('保存为模板', `
      <form onsubmit="app.handleSavePollAsTemplate(event)">
        <div class="form-group">
          <label>模板名称 *</label>
          <input type="text" id="tpl-save-name" required maxlength="100">
        </div>
        <div class="form-group">
          <label>描述</label>
          <textarea id="tpl-save-desc" rows="2" maxlength="500"></textarea>
        </div>
        <div class="checkbox-list">
          <label class="checkbox-item">
            <input type="checkbox" id="tpl-save-public">
            <span>公开为模板市场</span>
          </label>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="app.closeModal()">取消</button>
          <button type="submit" class="btn btn-primary">保存</button>
        </div>
      </form>
    `);
  },

  async handleSavePollAsTemplate(e) {
    e.preventDefault();
    const name = document.getElementById('tpl-save-name').value.trim();
    const description = document.getElementById('tpl-save-desc').value.trim();
    const is_public = document.getElementById('tpl-save-public').checked;

    if (!name) {
      this.showToast('名称必填', 'error');
      return;
    }

    try {
      const res = await this.request(`/templates/from-poll/${this.currentPollId}`, {
        method: 'POST',
        body: JSON.stringify({ name, description, is_public })
      });
      if (res.ok) {
        this.showToast('已保存为模板', 'success');
        this.closeModal();
      } else {
        const data = await res.json();
        this.showToast(data.error || '保存失败', 'error');
      }
    } catch (err) {
      this.showToast('网络错误', 'error');
    }
  },

  async loadGroups() {
    try {
      const res = await this.request('/groups');
      this.groups = await res.json();
      this.renderGroups();
    } catch (err) {
      console.error('加载议程失败', err);
    }
  },

  renderGroups() {
    const container = document.getElementById('groups-list');
    if (!container) return;

    if (this.groups.length === 0) {
      container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #999;">暂无议程，点击右上角创建</div>';
      return;
    }

    container.innerHTML = this.groups.map(g => {
      const p = g.progress || { completed: 0, active: 0, pending: 0, total: 0 };
      const completedPct = p.total > 0 ? (p.completed / p.total) * 100 : 0;
      const activePct = p.total > 0 ? (p.active / p.total) * 100 : 0;
      const pendingPct = p.total > 0 ? (p.pending / p.total) * 100 : 0;

      return `
        <div class="poll-card" onclick="app.viewGroup(${g.id})">
          <div class="poll-card-header">
            <div class="poll-card-title">${g.name}</div>
          </div>
          <p class="poll-card-desc">${g.description || '暂无描述'}</p>
          <div style="margin-top:12px;">
            <div style="display:flex;gap:0;height:10px;border-radius:5px;overflow:hidden;background:#eee;">
              <div style="width:${completedPct}%;background:#00a854;"></div>
              <div style="width:${activePct}%;background:#007bff;"></div>
              <div style="width:${pendingPct}%;background:#ccc;"></div>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:12px;color:#666;">
              <span>✓ ${p.completed} 已完成</span>
              <span>▶ ${p.active} 进行中</span>
              <span>○ ${p.pending} 未开始</span>
            </div>
          </div>
          <div class="poll-card-meta" style="margin-top:12px;">
            <span>📋 ${p.total}个投票</span>
            ${g.global_deadline ? `<span>⏰ ${new Date(g.global_deadline).toLocaleString('zh-CN')}</span>` : ''}
          </div>
        </div>
      `;
    }).join('');
  },

  showCreateGroupModal() {
    this.showModal('创建议程', `
      <form onsubmit="app.handleCreateGroup(event)">
        <div class="form-group">
          <label>议程名称 *</label>
          <input type="text" id="grp-name" required maxlength="100">
        </div>
        <div class="form-group">
          <label>描述</label>
          <textarea id="grp-desc" rows="2" maxlength="500"></textarea>
        </div>
        <div class="form-group">
          <label>全局截止时间</label>
          <input type="datetime-local" id="grp-deadline">
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="app.closeModal()">取消</button>
          <button type="submit" class="btn btn-primary">创建</button>
        </div>
      </form>
    `);
  },

  async handleCreateGroup(e) {
    e.preventDefault();
    const name = document.getElementById('grp-name').value.trim();
    const description = document.getElementById('grp-desc').value.trim();
    const global_deadline = document.getElementById('grp-deadline').value;

    if (!name) {
      this.showToast('名称必填', 'error');
      return;
    }

    try {
      const res = await this.request('/groups', {
        method: 'POST',
        body: JSON.stringify({ name, description, global_deadline: global_deadline || null })
      });
      if (res.ok) {
        this.showToast('议程创建成功', 'success');
        this.closeModal();
        this.loadGroups();
      } else {
        const data = await res.json();
        this.showToast(data.error || '创建失败', 'error');
      }
    } catch (err) {
      this.showToast('网络错误', 'error');
    }
  },

  async viewGroup(groupId) {
    this.currentGroupId = groupId;
    this.showPage('group-detail');
    await this.loadGroupDetail();
  },

  async loadGroupDetail() {
    try {
      const res = await this.request(`/groups/${this.currentGroupId}`);
      const group = await res.json();
      this.renderGroupDetail(group);
    } catch (err) {
      console.error('加载议程详情失败', err);
    }
  },

  renderGroupDetail(group) {
    const container = document.getElementById('group-detail');
    if (!container) return;

    const items = group.items || [];

    container.innerHTML = `
      <div class="poll-detail-container">
        <div class="poll-detail-header">
          <h2>${group.name}</h2>
          <p class="poll-detail-desc">${group.description || '暂无描述'}</p>
          <div class="poll-detail-info">
            <span>📋 ${items.length}个投票</span>
            ${group.global_deadline ? `<span>⏰ ${new Date(group.global_deadline).toLocaleString('zh-CN')}</span>` : ''}
          </div>
        </div>
        <div style="margin-bottom:16px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" onclick="app.showAddPollToGroupModal()">+ 添加投票</button>
          <button class="btn btn-outline btn-sm" onclick="app.exportGroupReport()">📥 导出汇总报告</button>
        </div>
        <div id="group-items-list">
          ${this.renderGroupItems(items)}
        </div>
      </div>
    `;
  },

  renderGroupItems(items) {
    if (items.length === 0) {
      return '<div style="text-align:center;padding:40px;color:#999;">暂无投票，点击上方按钮添加</div>';
    }

    const typeNames = {
      single: '单选', multiple: '多选', ranked: '排序', score: '评分', weighted: '权重'
    };

    return `
      <div id="sortable-items">
        ${items.map((item, idx) => {
          let statusText = item.status === 'active' ? '进行中' : (item.status === 'ended' ? '已结束' : '草稿');
          let statusClass = item.status === 'active' ? 'status-active' : (item.status === 'ended' ? 'status-ended' : 'status-draft');
          if (item.status === 'active' && item.deadline && new Date(item.deadline) < new Date()) {
            statusText = '已结束';
            statusClass = 'status-ended';
          }
          return `
            <div class="group-item" draggable="true" data-id="${item.poll_id}" data-idx="${idx}">
              <div class="group-item-handle">⋮⋮</div>
              <div class="group-item-content" style="flex:1;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <strong>#${idx + 1} ${item.title}</strong>
                  <span class="poll-status ${statusClass}">${statusText}</span>
                </div>
                <div style="color:#888;font-size:13px;margin-top:4px;">
                  <span class="poll-type-badge">${typeNames[item.type] || item.type}</span>
                  <span style="margin-left:8px;">👤 ${item.creator_name}</span>
                </div>
              </div>
              <div style="display:flex;gap:4px;">
                <button class="btn btn-outline btn-xs" onclick="event.stopPropagation();app.viewPoll(${item.poll_id})">查看</button>
                <button class="btn btn-danger btn-xs" onclick="event.stopPropagation();app.removePollFromGroup(${item.poll_id})">移除</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      <p style="font-size:12px;color:#999;margin-top:12px;">提示：拖拽调整投票顺序</p>
    ` + this.initDragSort();
  },

  initDragSort() {
    setTimeout(() => {
      const container = document.getElementById('sortable-items');
      if (!container) return;
      let draggedItem = null;
      container.querySelectorAll('.group-item').forEach(item => {
        item.addEventListener('dragstart', (e) => {
          draggedItem = item;
          item.style.opacity = '0.5';
        });
        item.addEventListener('dragend', () => {
          item.style.opacity = '1';
        });
        item.addEventListener('dragover', (e) => {
          e.preventDefault();
        });
        item.addEventListener('drop', (e) => {
          e.preventDefault();
          if (!draggedItem || draggedItem === item) return;
          const items = Array.from(container.children);
          const draggedIdx = items.indexOf(draggedItem);
          const dropIdx = items.indexOf(item);
          if (draggedIdx < dropIdx) {
            item.parentNode.insertBefore(draggedItem, item.nextSibling);
          } else {
            item.parentNode.insertBefore(draggedItem, item);
          }
          this.updateGroupOrder();
        });
      });
    }, 50);
    return '';
  },

  async updateGroupOrder() {
    const items = document.querySelectorAll('.group-item');
    const orderedIds = Array.from(items).map(el => parseInt(el.dataset.id));
    try {
      await this.request(`/groups/${this.currentGroupId}/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ ordered_poll_ids: orderedIds })
      });
      this.showToast('排序已更新', 'success');
    } catch (err) {
      console.error('更新排序失败', err);
    }
  },

  showAddPollToGroupModal() {
    const availablePolls = this.polls.filter(p => {
      const groupDetail = document.getElementById('group-detail');
      const items = this.currentGroupPolls || [];
      return !items.some(i => i.poll_id === p.id);
    });

    this.showModal('添加投票到议程', `
      <div id="add-poll-list" style="max-height:400px;overflow-y:auto;">
        ${availablePolls.length === 0 ? '<p style="color:#999;text-align:center;padding:20px;">暂无可添加的投票</p>' :
          availablePolls.map(p => `
            <div style="padding:12px;border:1px solid #eee;border-radius:6px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
              <div>
                <strong>${p.title}</strong>
                <div style="color:#888;font-size:12px;margin-top:4px;">${p.options.length}个选项 · ${p.total_voted}人已投票</div>
              </div>
              <button class="btn btn-primary btn-sm" onclick="app.addPollToGroup(${p.id})">添加</button>
            </div>
          `).join('')
        }
      </div>
    `);
  },

  async addPollToGroup(pollId) {
    try {
      const res = await this.request(`/groups/${this.currentGroupId}/items`, {
        method: 'POST',
        body: JSON.stringify({ poll_id: pollId })
      });
      if (res.ok) {
        this.showToast('已添加', 'success');
        this.closeModal();
        await this.loadGroupDetail();
      } else {
        const data = await res.json();
        this.showToast(data.error || '添加失败', 'error');
      }
    } catch (err) {
      this.showToast('网络错误', 'error');
    }
  },

  async removePollFromGroup(pollId) {
    if (!confirm('确定移除该投票吗？')) return;
    try {
      const res = await this.request(`/groups/${this.currentGroupId}/items/${pollId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        this.showToast('已移除', 'success');
        await this.loadGroupDetail();
      } else {
        this.showToast('移除失败', 'error');
      }
    } catch (err) {
      this.showToast('网络错误', 'error');
    }
  },

  async exportGroupReport() {
    try {
      const res = await this.request(`/groups/${this.currentGroupId}/export`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `group-${this.currentGroupId}-report.html`;
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('导出成功', 'success');
      } else {
        this.showToast('导出失败', 'error');
      }
    } catch (err) {
      this.showToast('网络错误', 'error');
    }
  },

  async loadComments() {
    try {
      this.commentsOffset = 0;
      this.commentsHasMore = true;
      this.comments = [];
      await this.loadMoreComments();
    } catch (err) {
      console.error('加载评论失败', err);
    }
  },

  switchCommentsSort(sort) {
    this.commentsSort = sort;
    this.loadComments();
  },

  async loadMoreComments() {
    if (!this.commentsHasMore) return;
    try {
      const res = await this.request(`/polls/${this.currentPollId}/comments?sort=${this.commentsSort}&limit=20&offset=${this.commentsOffset}`);
      const data = await res.json();
      this.comments = this.comments.concat(data.comments);
      this.commentsHasMore = data.hasMore;
      this.commentsOffset += data.comments.length;
      this.renderComments();
    } catch (err) {
      console.error('加载更多评论失败', err);
    }
  },

  renderComments() {
    const container = document.getElementById('comments-list');
    const loadMoreBtn = document.getElementById('comments-load-more');
    if (!container) return;

    if (this.comments.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:20px;color:#999;">暂无评论，快来发表第一条评论吧</div>';
      if (loadMoreBtn) loadMoreBtn.style.display = 'none';
      return;
    }

    container.innerHTML = this.comments.map(c => this.renderCommentItem(c)).join('');

    if (loadMoreBtn) {
      loadMoreBtn.style.display = this.commentsHasMore ? 'block' : 'none';
    }
  },

  renderCommentItem(c, isReply = false) {
    const isCreator = this.user && c.user_id === this.user.id;
    const canAdmin = this.user && c.poll_creator_id === this.user.id;
    const canDelete = isCreator || canAdmin;

    return `
      <div class="comment-item ${isReply ? 'comment-reply' : ''} ${c.is_pinned ? 'comment-pinned' : ''}" data-comment-id="${c.id}">
        <div class="comment-header">
          <div class="comment-author">
            <strong>${c.display_name || c.username}</strong>
            ${c.is_pinned ? '<span style="color:#fa8c16;font-size:12px;margin-left:8px;">📌 置顶</span>' : ''}
            <span style="color:#999;font-size:12px;margin-left:8px;">${new Date(c.created_at).toLocaleString('zh-CN')}</span>
          </div>
          <div class="comment-actions">
            <button class="btn-link" onclick="app.toggleCommentLike(${c.id})">
              ${c.liked ? '❤️' : '🤍'} ${c.like_count || 0}
            </button>
            ${!isReply ? `<button class="btn-link" onclick="app.showReplyInput(${c.id})">回复</button>` : ''}
            ${canAdmin && !isReply ? `<button class="btn-link" onclick="app.toggleCommentPin(${c.id})">${c.is_pinned ? '取消置顶' : '置顶'}</button>` : ''}
            ${canDelete ? `<button class="btn-link btn-danger" onclick="app.deleteComment(${c.id})">删除</button>` : ''}
          </div>
        </div>
        <div class="comment-content">${this.escapeHtml(c.content)}</div>
        ${!isReply ? `
          <div id="reply-input-${c.id}" style="display:none;margin-top:8px;">
            <textarea id="reply-text-${c.id}" rows="2" placeholder="回复 ${c.display_name}..."></textarea>
            <div style="text-align:right;margin-top:4px;">
              <button class="btn btn-outline btn-xs" onclick="document.getElementById('reply-input-${c.id}').style.display='none'">取消</button>
              <button class="btn btn-primary btn-xs" onclick="app.submitReply(${c.id})">回复</button>
            </div>
          </div>
        ` : ''}
        ${!isReply && c.replies && c.replies.length > 0 ? `
          <div class="comment-replies">
            ${c.replies.map(r => this.renderCommentItem(r, true)).join('')}
          </div>
        ` : ''}
      </div>
    `;
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  async submitComment() {
    const input = document.getElementById('comment-input');
    if (!input) return;
    const content = input.value.trim();
    if (!content) {
      this.showToast('评论内容不能为空', 'error');
      return;
    }
    try {
      const res = await this.request(`/polls/${this.currentPollId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content })
      });
      if (res.ok) {
        input.value = '';
        this.showToast('评论成功', 'success');
        this.loadComments();
      } else {
        const data = await res.json();
        this.showToast(data.error || '评论失败', 'error');
      }
    } catch (err) {
      this.showToast('网络错误', 'error');
    }
  },

  showReplyInput(commentId) {
    document.querySelectorAll('[id^="reply-input-"]').forEach(el => {
      if (el.id !== `reply-input-${commentId}`) el.style.display = 'none';
    });
    const el = document.getElementById(`reply-input-${commentId}`);
    if (el) {
      el.style.display = el.style.display === 'none' ? 'block' : 'none';
      if (el.style.display === 'block') {
        setTimeout(() => document.getElementById(`reply-text-${commentId}`)?.focus(), 50);
      }
    }
  },

  async submitReply(parentId) {
    const input = document.getElementById(`reply-text-${parentId}`);
    if (!input) return;
    const content = input.value.trim();
    if (!content) {
      this.showToast('回复内容不能为空', 'error');
      return;
    }
    try {
      const res = await this.request(`/polls/${this.currentPollId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content, parent_id: parentId })
      });
      if (res.ok) {
        this.showToast('回复成功', 'success');
        this.loadComments();
      } else {
        const data = await res.json();
        this.showToast(data.error || '回复失败', 'error');
      }
    } catch (err) {
      this.showToast('网络错误', 'error');
    }
  },

  async toggleCommentLike(commentId) {
    try {
      const res = await this.request(`/comments/${commentId}/like`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        const comment = this.findComment(commentId);
        if (comment) {
          comment.liked = data.liked;
          comment.like_count = data.like_count;
          this.renderComments();
        }
      }
    } catch (err) {
      console.error('点赞失败', err);
    }
  },

  findComment(commentId, list = this.comments) {
    for (const c of list) {
      if (c.id === commentId) return c;
      if (c.replies) {
        const found = this.findComment(commentId, c.replies);
        if (found) return found;
      }
    }
    return null;
  },

  async toggleCommentPin(commentId) {
    try {
      const res = await this.request(`/comments/${commentId}/pin`, {
        method: 'PUT'
      });
      if (res.ok) {
        const data = await res.json();
        this.showToast(data.message || '操作成功', 'success');
        this.loadComments();
      } else {
        const data = await res.json();
        this.showToast(data.error || '操作失败', 'error');
      }
    } catch (err) {
      this.showToast('网络错误', 'error');
    }
  },

  async deleteComment(commentId) {
    if (!confirm('确定删除此评论吗？')) return;
    try {
      const res = await this.request(`/comments/${commentId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        this.showToast('已删除', 'success');
        this.loadComments();
      } else {
        const data = await res.json();
        this.showToast(data.error || '删除失败', 'error');
      }
    } catch (err) {
      this.showToast('网络错误', 'error');
    }
  },

  async loadNotifications() {
    try {
      const res = await this.request('/notifications?limit=20');
      const data = await res.json();
      this.notifications = data.notifications;
      this.updateNotificationBadge(data.unreadCount);
      this.renderNotifications();
    } catch (err) {
      console.error('加载通知失败', err);
    }
  },

  startNotificationPolling() {
    if (this.notificationInterval) clearInterval(this.notificationInterval);
    this.notificationInterval = setInterval(() => {
      this.loadNotifications();
    }, 30000);
  },

  updateNotificationBadge(count) {
    const badge = document.getElementById('notificationBadge');
    if (!badge) return;
    if (count > 0) {
      badge.style.display = 'inline';
      badge.textContent = count > 99 ? '99+' : count;
    } else {
      badge.style.display = 'none';
    }
  },

  toggleNotificationPanel() {
    const panel = document.getElementById('notificationPanel');
    if (!panel) return;
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      this.renderNotifications();
    }
  },

  renderNotifications() {
    const list = document.getElementById('notificationList');
    if (!list) return;

    if (this.notifications.length === 0) {
      list.innerHTML = '<div style="text-align:center;padding:20px;color:#999;">暂无通知</div>';
      return;
    }

    list.innerHTML = this.notifications.map(n => `
      <div class="notification-item ${n.is_read ? '' : 'unread'}" onclick="app.markNotificationRead(${n.id}, ${n.poll_id})">
        <div class="notification-title">${n.title}</div>
        <div class="notification-content">${n.content}</div>
        <div class="notification-time">${new Date(n.created_at).toLocaleString('zh-CN')}</div>
      </div>
    `).join('');
  },

  async markNotificationRead(id, pollId) {
    try {
      await this.request(`/notifications/${id}/read`, { method: 'PUT' });
      this.loadNotifications();
      if (pollId) {
        this.viewPoll(pollId);
        document.getElementById('notificationPanel')?.classList.add('hidden');
      }
    } catch (err) {
      console.error('标记已读失败', err);
    }
  },

  async markAllNotificationsRead() {
    try {
      await this.request('/notifications/read-all', { method: 'PUT' });
      this.showToast('已全部标记为已读', 'success');
      this.loadNotifications();
    } catch (err) {
      this.showToast('操作失败', 'error');
    }
  },

  async loadSettings() {
    try {
      const res = await this.request('/user/settings');
      const settings = await res.json();
      document.getElementById('setting-notify-before-end').checked = !!settings.notify_before_end;
      document.getElementById('setting-notify-before-start').checked = !!settings.notify_before_start;
      document.getElementById('setting-notify-result').checked = !!settings.notify_result_ready;
      document.getElementById('setting-notify-invite').checked = !!settings.notify_new_invite;
    } catch (err) {
      console.error('加载设置失败', err);
    }
  },

  async saveSettings() {
    const settings = {
      notify_before_end: document.getElementById('setting-notify-before-end').checked,
      notify_before_start: document.getElementById('setting-notify-before-start').checked,
      notify_result_ready: document.getElementById('setting-notify-result').checked,
      notify_new_invite: document.getElementById('setting-notify-invite').checked
    };
    try {
      const res = await this.request('/user/settings', {
        method: 'PUT',
        body: JSON.stringify(settings)
      });
      if (res.ok) {
        this.showToast('设置已保存', 'success');
      } else {
        this.showToast('保存失败', 'error');
      }
    } catch (err) {
      this.showToast('网络错误', 'error');
    }
  },

  async loadComparePolls() {
    const container = document.getElementById('compare-polls-list');
    if (!container) return;

    await this.loadPolls();

    const endedPolls = this.polls.filter(p => {
      const isEnded = p.status === 'ended' || (p.deadline && new Date(p.deadline) < new Date());
      return isEnded;
    });

    if (endedPolls.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:20px;color:#999;">暂无可对比的已结束投票</div>';
      return;
    }

    const typeNames = {
      single: '单选', multiple: '多选', ranked: '排序', score: '评分', weighted: '权重'
    };

    container.innerHTML = endedPolls.map(p => `
      <label class="user-checkbox-item">
        <input type="checkbox" value="${p.id}" data-type="${p.type}" onchange="app.toggleCompareCheckbox(this)">
        <span>
          <strong>${p.title}</strong>
          <span style="color:#888;font-size:12px;margin-left:8px;">[${typeNames[p.type] || p.type}] ${new Date(p.created_at).toLocaleDateString('zh-CN')}</span>
        </span>
      </label>
    `).join('');
  },

  toggleCompareCheckbox(checkbox) {
    const item = checkbox.closest('.user-checkbox-item');
    if (item) item.classList.toggle('selected', checkbox.checked);
  },

  async runComparison() {
    const checkboxes = document.querySelectorAll('#compare-polls-list input:checked');
    const selected = Array.from(checkboxes).map(cb => ({
      id: parseInt(cb.value),
      type: cb.dataset.type
    }));

    if (selected.length < 2) {
      this.showToast('至少选择2个投票', 'error');
      return;
    }

    const types = [...new Set(selected.map(s => s.type))];
    if (types.length > 1) {
      this.showToast('只能对比同类型投票', 'error');
      return;
    }

    try {
      const res = await this.request('/polls/compare', {
        method: 'POST',
        body: JSON.stringify({ poll_ids: selected.map(s => s.id) })
      });
      if (res.ok) {
        const data = await res.json();
        this.renderCompareResults(data);
      } else {
        const data = await res.json();
        this.showToast(data.error || '对比失败', 'error');
      }
    } catch (err) {
      this.showToast('网络错误', 'error');
    }
  },

  renderCompareResults(data) {
    const container = document.getElementById('compare-results');
    if (!container) return;

    const polls = data.polls || [];
    const trend = data.trend || { trends: [] };

    const colors = ['#007bff', '#00a854', '#fa8c16', '#722ed1', '#eb2f96', '#13c2c2', '#faad14', '#f5222d'];

    container.innerHTML = `
      <div class="chart-container" id="trend-chart-container">
        <div class="chart-title-row">
          <div class="chart-title">📈 趋势对比分析</div>
          <button class="btn btn-outline btn-xs" onclick="app.exportChartAsPNG('trend-chart-container', '趋势对比图')">📷 导出PNG</button>
        </div>
        <div class="chart-wrapper">
          ${this.renderTrendLineChart(polls, trend, colors)}
        </div>
      </div>
      <div class="chart-container">
        <div class="chart-title">📊 趋势分析详情</div>
        ${trend.trends?.length > 0 ? `
          <table class="votes-table">
            <tr><th>选项</th><th>趋势</th><th>变化量</th><th>变化率</th><th>平均值</th><th>最高</th><th>最低</th></tr>
            ${trend.trends.map((t, i) => {
              const trendIcon = t.trend === 'rising' ? '📈' : (t.trend === 'falling' ? '📉' : '➡️');
              const trendText = t.trend === 'rising' ? '上升' : (t.trend === 'falling' ? '下降' : (t.trend === 'stable' ? '稳定' : '数据不足'));
              return `<tr>
                <td><span style="display:inline-block;width:10px;height:10px;background:${colors[i % colors.length]};margin-right:6px;"></span>${t.option}</td>
                <td>${trendIcon} ${trendText}</td>
                <td>${t.change > 0 ? '+' : ''}${t.change}</td>
                <td>${t.changePercent ? (t.changePercent > 0 ? '+' : '') + t.changePercent + '%' : '-'}</td>
                <td>${t.average}</td>
                <td>${t.max}</td>
                <td>${t.min}</td>
              </tr>`;
            }).join('')}
          </table>
        ` : '<p style="color:#999;text-align:center;padding:20px;">数据不足</p>'}
      </div>
    `;
  },

  renderTrendLineChart(polls, trend, colors) {
    const trends = trend.trends || [];
    const pollCount = polls.length;
    if (pollCount < 2 || trends.length === 0) {
      return '<p style="color:#999;text-align:center;padding:20px;">数据不足</p>';
    }

    const width = 700;
    const height = 400;
    const padding = { top: 30, right: 30, bottom: 60, left: 60 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const allVals = [];
    trends.forEach(t => t.scores.forEach(s => { if (s !== null) allVals.push(s); }));
    const maxVal = Math.max(...allVals, 1);
    const minVal = Math.min(...allVals, 0);
    const valRange = maxVal - minVal || 1;

    const xStep = chartW / (pollCount - 1 || 1);

    let gridSvg = '';
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
      const y = padding.top + (chartH * i) / gridLines;
      const val = maxVal - (valRange * i) / gridLines;
      gridSvg += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#eee" stroke-width="1"/>`;
      gridSvg += `<text x="${padding.left - 8}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="10" fill="#888">${val.toFixed(1)}</text>`;
    }

    let xLabelsSvg = '';
    polls.forEach((p, i) => {
      const x = padding.left + i * xStep;
      xLabelsSvg += `<line x1="${x}" y1="${height - padding.bottom}" x2="${x}" y2="${height - padding.bottom + 5}" stroke="#999" stroke-width="1"/>`;
      xLabelsSvg += `<text x="${x}" y="${height - padding.bottom + 20}" text-anchor="middle" font-size="10" fill="#666" transform="rotate(-25, ${x}, ${height - padding.bottom + 20})">${p.title.length > 8 ? p.title.substring(0, 8) + '...' : p.title}</text>`;
    });

    let linesSvg = '';
    let dotsSvg = '';
    let legendSvg = '';

    trends.forEach((t, idx) => {
      const color = colors[idx % colors.length];
      const points = [];
      t.scores.forEach((s, i) => {
        if (s !== null) {
          const x = padding.left + i * xStep;
          const y = padding.top + chartH - ((s - minVal) / valRange) * chartH;
          points.push(`${x},${y}`);
          dotsSvg += `<circle cx="${x}" cy="${y}" r="4" fill="${color}"/>`;
        }
      });
      if (points.length > 1) {
        linesSvg += `<polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>`;
      }

      const legendY = height - 15;
      const legendX = padding.left + idx * 120;
      legendSvg += `<rect x="${legendX}" y="${legendY}" width="10" height="10" fill="${color}"/>`;
      legendSvg += `<text x="${legendX + 14}" y="${legendY + 8}" font-size="11" fill="#333">${t.option}</text>`;
    });

    return `<svg width="${width}" height="${height + 30}" viewBox="0 0 ${width} ${height + 30}">
      ${gridSvg}
      <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke="#ccc" stroke-width="1"/>
      <line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="#ccc" stroke-width="1"/>
      ${xLabelsSvg}
      ${linesSvg}
      ${dotsSvg}
      ${legendSvg}
    </svg>`;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  app.init();

  document.addEventListener('click', (e) => {
    const panel = document.getElementById('notificationPanel');
    const btn = document.getElementById('notificationBtn');
    if (panel && btn && !panel.contains(e.target) && !btn.contains(e.target)) {
      panel.classList.add('hidden');
    }
  });
});