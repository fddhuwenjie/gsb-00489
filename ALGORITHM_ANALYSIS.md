# 投票算法正确性与健壮性分析报告

## 1. Condorcet 方法与 Smith 集分析

### 1.1 循环偏好回退逻辑

**分析结论：Condorcet 仅作为分析工具存在，无独立回退机制。**

当前系统中，`findCondorcetWinner` 函数仅作为"高级分析"功能的一部分，并不决定最终投票结果。当存在循环偏好（无 Condorcet 赢家）时，函数仅返回 `hasWinner: false`，不存在任何回退算法。

**代码位置：**
- [voting-algorithms.js#L176-L243](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L176-L243) — `findCondorcetWinner` 函数
- [server.js#L377-L388](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L377-L388) — 结果接口中调用 Condorcet 和 Smith 分析

**具体问题：**

1. **无回退算法**：当出现循环偏好（如 A>B, B>C, C>A）时，系统仅告知"不存在 Condorcet 赢家"，并未提供任何替代方案（如 Copeland 法、Schulze 法、Minimax 法等常用回退策略）。

2. **角色定位不清**：Condorcet 赢家在系统中仅作展示，不影响排序投票（ranked 类型）的最终结果。排序投票实际采用 Borda 计数法，两者可能产生不同的获胜者，容易造成用户困惑。

### 1.2 Smith 集计算正确性

**分析结论：Smith 集算法在多数场景下正确，但平票处理和边界场景存在隐患。**

**代码位置：**
- [voting-algorithms.js#L245-L276](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L245-L276) — `findSmithSet` 函数

**算法描述：**
当前实现采用"迭代移除最弱选项"的策略：从所有选项开始，反复移除那些"输给集合内所有其他选项"的选项，直到没有可移除项为止。

**平票处理分析：**

```javascript
const beats = (a, b) => (matrix[a][b] || 0) > (matrix[b][a] || 0);
```

`beats` 函数使用严格大于，平票时双方互相都不"击败"对方。

- **影响**：在平票场景下，`losesToAllOthers` 条件更难满足，选项更难被移除。
- **示例**：若 A 与 B 平票，且两者都击败 C、D。则 C、D 会被移除，A、B 保留，最终 Smith 集为 {A, B}，此结果正确。

**全等场景（所有选项两两平票）：**
- 所有选项都不满足 `losesToAllOthers`（因为没有选项被击败），因此不会有任何选项被移除。
- 最终 Smith 集包含所有选项，符合预期。

**正确性隐患：**

1. **非标准算法**：当前实现并非标准的 Smith 集计算方法。标准算法应通过强连通分量（SCC）分析（如基于 Floyd-Warshall 或 Kosaraju 算法）来寻找最高拓扑序的 SCC。当前"迭代移除最弱"策略在简单循环场景下能得到正确结果，但缺乏理论完备性保证。

2. **部分击败场景**：考虑以下对决矩阵（A>B 表示 A 击败 B）：
   - A > C, D, E
   - B > C, D, E
   - A 与 B 平票
   - C > E
   - D > C, E
   
   标准 Smith 集应为 {A, B}，当前算法能正确得出此结果。但对于更复杂的图结构（如存在多个分层的循环），当前算法可能无法正确收敛。

### 1.3 改进建议

1. **为 Condorcet 增加回退策略**：当不存在 Condorcet 赢家时，可采用以下任一方法作为补充：
   - **Copeland 法**：每个选项胜一场得 1 分，平一场得 0.5 分，负一场得 0 分，总分高者获胜。
   - **Schulze 法**：计算任意两选项间的最强路径，路径强度由瓶颈对决的差距决定。
   - **Minimax 法**：选择"最大最小差距"最小的选项（即最差表现最好的选项）。

2. **替换 Smith 集算法**：使用基于 Floyd-Warshall 的标准算法计算 Smith 集，确保理论正确性：

```javascript
function findSmithSet(votes, options) {
  const optionIds = options.map(o => o.id);
  const n = optionIds.length;
  const condorcet = findCondorcetWinner(votes, options);
  const matrix = condorcet.pairwiseMatrix;

  // Floyd-Warshall 计算传递闭包（是否存在路径 a → ... → b）
  const path = {};
  optionIds.forEach(a => {
    path[a] = {};
    optionIds.forEach(b => {
      path[a][b] = (matrix[a][b] || 0) > (matrix[b][a] || 0);
    });
  });

  optionIds.forEach(k => {
    optionIds.forEach(i => {
      optionIds.forEach(j => {
        if (path[i][k] && path[k][j]) {
          path[i][j] = true;
        }
      });
    });
  });

  // 寻找 Smith 集：所有能到达的选项的交集的补集
  let smithSet = optionIds.filter(a => 
    optionIds.every(b => !path[b][a] || path[a][b])
  );

  // 确保非空
  if (smithSet.length === 0) {
    smithSet = [...optionIds];
  }

  return {
    smithSet,
    smithSetTexts: smithSet.map(id => options.find(o => o.id === id)?.text),
    size: smithSet.length
  };
}
```

3. **增加平票特殊处理**：在 Smith 集结果中区分"严格击败"和"平票"两种情况，提升结果可解释性。

---

## 2. Borda 计数与动态选项分析

### 2.1 积分归一化偏差

**分析结论：Borda 计数未做归一化，不完整排名的投票者影响力被削弱。**

**代码位置：**
- [voting-algorithms.js#L53-L81](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L53-L81) — `calculateBorda` 函数

**算法描述：**
标准 Borda 计数，n 个选项时第 k 名得 (n-1-k) 分。代码仅对 `voteData.ranking` 中出现的选项计分，未排名的选项得 0 分。

**偏差分析：**

1. **截断排名的影响**：
   - 假设总共有 5 个选项，完整排名的投票者投出总分为 `0+1+2+3+4 = 10` 分。
   - 若某投票者仅排名前 3 个选项，其投出总分为 `2+1+0 = 3` 分。
   - 这意味着"偷懒"的投票者对最终结果的影响力显著降低。

2. **策略性投票风险**：
   - 理性投票者可能故意不给弱势选项排名，将全部积分集中在自己支持的选项上？
   - **反直觉结论**：实际上，不排名弱势选项并不会让你支持的选项获得更多分数（第一名永远得 n-1 分，与是否排名其他选项无关）。但未排名的选项得 0 分，相当于默认把它们排在最后。
   - 因此，截断排名等价于将未排名选项全部视为并列最后一名。这本身不一定是"偏差"，但需要明确告知用户。

3. **部分弃权的公平性**：
   - 若 `allow_abstain` 为 true，用户可以整体弃权；但"部分弃权"（仅排名部分选项）是否合理？
   - 当前系统中，排序投票的前端默认展示所有选项并强制全部排名（通过上下箭头调整），理论上不会出现不完整排名。
   - 但后端未做校验，如果有人绕过前端直接发送不完整的 ranking 数组，后端会照单全收。

### 2.2 选项数量动态变化

**分析结论：多轮淘汰制下，Borda 计数在每轮独立计算，不存在跨轮归一化问题；但单轮内选项淘汰可能造成历史投票数据语义变化。**

**代码位置：**
- [server.js#L468-L510](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L468-L510) — 下一轮投票接口

**具体问题：**

1. **淘汰后排名语义变化**：
   - 第 1 轮有 5 个选项，用户排名 [A, B, C, D, E]，此时 A 得 4 分。
   - 第 2 轮淘汰 E，剩余 4 个选项。如果用户沿用相同的偏好顺序 [A, B, C, D]，此时 A 得 3 分。
   - 跨轮比较分数绝对值没有意义（因为 n 变了）。
   - 但当前系统每轮独立计算结果，不存在跨轮分数比较，因此此问题不影响正确性。

2. **历史投票数据复用问题**：
   - 多轮投票中，每轮用户需要重新投票吗？
   - 代码中 `votes` 表有 `round` 字段，每轮的投票是独立的。
   - 但如果用户在新一轮没有投票，系统不会自动沿用其上一轮的排名。这本身不是 bug，但可能影响参与率。

### 2.3 改进建议

1. **后端校验 ranking 完整性**：在提交投票时，验证 `ranking` 数组是否包含所有活跃选项，防止绕过前端的不完整投票：

```javascript
// 在 POST /api/polls/:id/vote 中增加校验
if (poll.type === 'ranked' && !is_abstain) {
  const activeOptions = options.filter(o => !o.eliminated);
  const ranking = vote_data.ranking || [];
  const hasAllOptions = activeOptions.every(opt => ranking.includes(opt.id));
  const hasNoExtra = ranking.every(id => activeOptions.some(opt => opt.id === id));
  if (!hasAllOptions || ranking.length !== activeOptions.length || !hasNoExtra) {
    return res.status(400).json({ error: '排序投票必须包含且仅包含所有有效选项' });
  }
}
```

2. **可选：提供归一化 Borda**：作为可选模式，将每个投票者的总得分归一化到相同权重（如总权重恒为 1），确保每人影响力相同。例如，只排名前 k 个的投票者，其每个排名的分数按比例放大。

3. **明确文档说明**：在用户界面中明确说明 Borda 计数规则，以及截断排名的等价语义。

---

## 3. 匿名投票隐私泄露分析

### 3.1 泄露路径总览

**分析结论：匿名投票模式存在多处严重的隐私泄露路径，匿名性基本失效。**

| 泄露路径 | 严重程度 | 泄露内容 | 代码位置 |
|---------|---------|---------|---------|
| 热力图接口 | 🔴 严重 | 每个用户的完整投票内容 | [server.js#L1283-L1298](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L1283-L1298) |
| 稳定性分析 | 🟠 中等 | 关键投票者用户 ID 列表 | [voting-algorithms.js#L278-L312](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L278-L312) |
| 投票详情接口 | 🟡 轻微 | 已投票用户列表（谁参与了） | [server.js#L245-L251](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L245-L251) |
| 审计日志 | 🟠 中等 | 投票时间、操作类型 | [server.js#L530-L554](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L530-L554) |
| 前端状态不一致 | 🟡 轻微 | can_see_votes 标志误导 | [server.js#L391-L435](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L391-L435) |

### 3.2 详细分析

#### 3.2.1 热力图接口——完全匿名失效

**代码位置：** [server.js#L1283-L1298](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L1283-L1298)

```javascript
app.get('/api/polls/:id/visualization/heatmap', authenticateToken, (req, res) => {
  // ... 无匿名检查 ...
  const heatmap = calculateScoreMatrix(poll, votes, options, voters);
  res.json(heatmap);
});
```

**问题**：
- 该接口完全没有检查 `poll.is_anonymous` 标志。
- `calculateScoreMatrix` 返回 `userLabels`（用户显示名）和 `matrix`（每个用户对每个选项的具体分值/排名）。
- 任何受邀用户都可以调用此接口，获得每个投票者的完整投票内容。
- 这是最严重的隐私泄露，匿名投票形同虚设。

#### 3.2.2 稳定性分析——关键投票者身份泄露

**代码位置：** [voting-algorithms.js#L303-L310](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L303-L310)

```javascript
const pivotalVoters = analyses.filter(a => a.pivotal).map(a => a.voter_id);
return {
  stable: !canChange,
  pivotalVoterCount: pivotalVoters.length,
  pivotalVoters,  // 返回用户ID数组
  // ...
};
```

**问题**：
- `analyzeStability` 返回 `pivotalVoters` 数组，包含所有能改变结果的投票者的 user_id。
- 在匿名投票中，虽然看不到所有人的投票，但能看到"关键投票者"是谁。
- 结合投票人数较少的场景，可能反向推导出具体投票内容。
- 该数据通过 `/api/polls/:id/results` 接口的 `advanced_analysis.stability` 字段返回，未做匿名过滤。

#### 3.2.3 投票详情接口——参与身份泄露

**代码位置：** [server.js#L245-L251](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L245-L251)

```javascript
const votedUsers = db.prepare(`
  SELECT DISTINCT v.user_id, u.display_name, u.username
  FROM votes v JOIN users u ON v.user_id = u.id
  WHERE v.poll_id = ? AND v.round = ?
`).all(pollId, poll.current_round);
poll.voted_users = votedUsers;
```

**问题**：
- `GET /api/polls/:id` 返回 `voted_users` 列表，展示哪些用户已经投票。
- 匿名投票通常要求"谁投了票"也不应公开（仅公布总票数），以防止投票胁迫。
- 当前实现保护了"投了什么"，但暴露了"谁投了"，属于部分匿名。

#### 3.2.4 审计日志——创建者可追溯

**代码位置：** [server.js#L530-L554](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L530-L554)

**问题**：
- 审计日志记录了每个用户的投票操作（submit_vote, update_vote, withdraw_vote）及时间戳。
- 只有创建者可查看，相对可控。
- 但审计日志的 `details` 字段未包含具体投票内容（仅记录了轮次），因此泄露程度有限。
- 不过，"谁在何时投了票"本身在高敏感场景下也属于敏感信息。

#### 3.2.5 前后端逻辑不一致

**代码位置：** [server.js#L390-L435](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L390-L435)

```javascript
let individualVotes = [];
if (!poll.is_anonymous || poll.creator_id === req.user.id) {
  individualVotes = db.prepare(...).all(...);  // 创建者会查询数据
}
// ...
res.json({
  individual_votes: poll.is_anonymous ? [] : individualVotes,  // 但返回时空数组
  can_see_votes: !poll.is_anonymous || poll.creator_id === req.user.id,  // 标志位为 true
});
```

**问题**：
- `can_see_votes` 对创建者返回 true，但 `individual_votes` 实际上是空数组。
- 前端可能根据 `can_see_votes` 来决定是否展示投票详情区域，导致创建者看到空列表或错误状态。
- 逻辑上存在不一致：代码查询了数据但未返回，属于多余操作。

### 3.3 改进建议

1. **修复热力图接口**：匿名投票时，热力图应去除用户维度，或仅展示聚合数据：

```javascript
if (poll.is_anonymous && poll.creator_id !== req.user.id) {
  // 匿名模式下不返回用户级热力图
  return res.status(403).json({ error: '匿名投票不支持热力图' });
  // 或者：返回按选项聚合的统计数据，不暴露单个用户信息
}
```

2. **匿名模式下隐藏关键投票者**：

```javascript
if (poll.is_anonymous && poll.creator_id !== req.user.id) {
  // 仅返回稳定性结论，不返回具体投票者ID
  stability = {
    stable: stability.stable,
    canChange: stability.canChange,
    pivotalVoterCount: stability.pivotalVoterCount
    // 移除 pivotalVoters 数组
  };
}
```

3. **隐藏已投票用户列表**：匿名投票时，`voted_users` 应只返回数量，不返回具体用户：

```javascript
if (poll.is_anonymous && poll.creator_id !== req.user.id) {
  poll.voted_users_count = votedUsers.length;
  poll.voted_users = [];
}
```

4. **审计日志匿名化**：对于匿名投票，审计日志中可考虑用哈希或假名替代真实用户 ID（仅创建者可见的情况下可保留，但需明确告知用户）。

5. **统一匿名判断逻辑**：封装一个 `canSeeIndividualVotes(poll, user)` 辅助函数，在所有接口中一致使用。

---

## 4. 加权分配算法边界行为

### 4.1 权重总和为零

**分析结论：总和为零时百分比为零，但 winner 仍返回第一个选项，语义不清。**

**代码位置：**
- [voting-algorithms.js#L121-L155](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L121-L155) — `calculateWeightedAllocation` 函数

**具体行为：**

```javascript
const totalAllocated = Object.values(results).reduce((a, b) => a + b, 0);
// ...
percentage: totalAllocated > 0 ? +((score / totalAllocated) * 100).toFixed(2) : 0,
// ...
winner: sorted[0]?.option_id,
```

- 当 `totalAllocated === 0` 时，所有选项的 `percentage` 为 0。
- `sorted` 数组按 `score` 降序排列，所有选项 score 都是 0 时，排序结果取决于初始遍历顺序（即选项 ID 顺序）。
- `winner` 取 `sorted[0]`，即返回 ID 最小的选项，这在"全零"场景下没有实际意义。

**触发场景：**
- 所有投票者都弃权
- 所有投票者都分配 0 分给所有选项（前端限制总和为 100，正常不会出现；但后端未校验）
- 所有用户权重为 0 且启用了加权投票

### 4.2 权重总和为负数

**分析结论：未做负数校验，可能出现负百分比和异常排序。**

**触发场景：**
- 若有人绕过前端，直接提交包含负数值的 allocations
- 或用户权重为负数时（虽然用户 weight 默认 1，但数据库中可手动修改为负）

**异常行为：**
1. **负百分比**：`score / totalAllocated` 可能为负，或因分母为负导致百分比排名颠倒。
2. **排序异常**：按 score 降序排列时，-10 分比 -5 分排名更低，但语义上"负分越多"意味着什么？是支持还是反对？
3. **赢家不合理**：score 最大（最接近 0）的选项成为 winner，但实际可能所有选项都是负分。

### 4.3 用户权重边界

**代码位置：**
- [server.js#L361-L368](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L361-L368) — 结果查询中加载用户权重
- [database.js#L17](file:///Users/huwenjie/项目/gsb/hwj-00489/database.js#L17) — 用户表 weight 字段定义

**问题：**
- 用户 `weight` 字段类型为 `REAL`，默认值 1，但无约束检查。
- 权重为 0 时，该用户的投票完全无效（乘以 0）。
- 权重为负时，相当于"反对票"效应——用户支持的选项得分反而降低。
- 系统未对权重值做任何范围校验，也没有在创建用户或管理用户时限制权重范围。

### 4.4 后端输入校验缺失

**分析结论：前端有总和校验，但后端完全信任 vote_data，存在注入和逻辑绕过风险。**

**前端校验**（app.js#L658-L671）：
```javascript
if (total !== 100) {
  this.showToast('权重总和必须等于100分', 'error');
  return;
}
```

**后端对应位置**（server.js#L258-L320）：
- 仅检查 `vote_data` 是否存在（非空），未验证内容格式和数值范围。
- 对于 weighted 类型，未校验 `allocations` 的总和是否为 100，也未校验单个值是否非负。
- 对于 score 类型，未校验分数是否在 0-10 范围内。
- 对于 ranked 类型，未校验 ranking 数组是否完整且无重复。

**风险：**
- 恶意用户可通过 API 直接提交任意数值，破坏投票公平性。
- 提交极大数值可能导致溢出（虽然 JS 数字精度有限，但分数过大可能影响前端展示）。
- 提交非预期结构的 vote_data 可能导致算法异常。

### 4.5 改进建议

1. **零总和边界处理**：

```javascript
function calculateWeightedAllocation(votes, options) {
  // ...
  const totalAllocated = Object.values(results).reduce((a, b) => a + b, 0);
  
  const hasValidVotes = totalAllocated > 0 && votes.some(v => !v.is_abstain);
  
  const sorted = Object.entries(results)
    .map(([id, score]) => ({
      option_id: parseInt(id),
      score: +score.toFixed(2),
      percentage: totalAllocated > 0 ? +((score / totalAllocated) * 100).toFixed(2) : 0,
      text: options.find(o => o.id === parseInt(id))?.text
    }))
    .sort((a, b) => b.score - a.score);

  return {
    type: 'weighted_allocation',
    results: sorted,
    winner: hasValidVotes ? sorted[0]?.option_id : null,
    totalVotes: votes.filter(v => !v.is_abstain).length,
    totalAllocated: +totalAllocated.toFixed(2),
    hasValidResult: hasValidVotes
  };
}
```

2. **负数和范围校验**：在投票提交接口增加数据合法性校验：

```javascript
// 后端 vote_data 校验逻辑
if (poll.type === 'weighted' && !is_abstain) {
  const allocations = vote_data.allocations || {};
  const total = Object.values(allocations).reduce((a, b) => a + (Number(b) || 0), 0);
  const allNonNegative = Object.values(allocations).every(v => Number(v) >= 0);
  if (!allNonNegative) {
    return res.status(400).json({ error: '分配值不能为负数' });
  }
  if (Math.abs(total - 100) > 0.01) {  // 允许浮点误差
    return res.status(400).json({ error: '权重分配总和必须等于100' });
  }
}
```

3. **用户权重约束**：
   - 数据库层面增加 CHECK 约束：`weight >= 0`（或 `weight > 0`）
   - 用户管理接口增加权重范围校验
   - 结果计算时对负权重做截断处理（取 0 或取绝对值并告警）

4. **全面的 vote_data 校验**：为每种投票类型编写校验函数，在后端统一验证投票数据的格式和数值范围，防止前端绕过。

---

## 总结

| 分析维度 | 总体评价 | 核心问题 |
|---------|---------|---------|
| Condorcet / Smith 集 | ⚠️ 部分正确 | 无回退机制，Smith 集算法非标准 |
| Borda 计数 | ⚠️ 基本正确 | 后端缺完整性校验，截断排名语义不明 |
| 匿名投票隐私 | 🔴 严重问题 | 热力图等接口完全破坏匿名性 |
| 加权分配边界 | ⚠️ 存在隐患 | 零/负权重行为未定义，后端缺输入校验 |

**最高优先级修复**：
1. 🔴 热力图接口增加匿名检查（最严重的隐私泄露）
2. 🟠 后端增加 vote_data 格式和数值校验（防止作弊和异常）
3. 🟠 匿名模式下移除稳定性分析中的关键投票者 ID
