# 投票算法正确性与健壮性分析报告

## 概述

本报告针对在线决策投票应用的核心算法进行全面的正确性与健壮性分析，覆盖 Condorcet 方法、Borda 计数、匿名投票隐私保护、加权分配边界行为四个维度。

**涉及的核心文件：**
- 算法实现：[voting-algorithms.js](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js)
- 后端服务：[server.js](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js)
- 前端交互：[public/js/app.js](file:///Users/huwenjie/项目/gsb/hwj-00489/public/js/app.js)

---

## 一、Condorcet 方法与 Smith 集计算分析

### 1.1 Condorcet 赢家查找的回退逻辑

**分析结论：Condorcet 无赢家时缺少明确的回退机制，且混合处理单选投票数据存在语义混乱。**

#### 问题详细分析

**（1）无回退机制**

[findCondorcetWinner](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L176-L243) 函数在没有 Condorcet 赢家时仅返回 `hasWinner: false`，但调用方未提供任何回退策略。

在 [server.js 第381-388行](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L381-L388) 的结果接口中：
```javascript
if (votes.length > 0) {
  try {
    condorcet = findCondorcetWinner(votes, options.filter(o => !o.eliminated));
    smithSet = findSmithSet(votes, options.filter(o => !o.eliminated));
    stability = analyzeStability(votes, options.filter(o => !o.eliminated), poll.type);
  } catch (e) {
  }
}
```
当无 Condorcet 赢家时，前端仅显示"不存在"，没有提供任何补充决策方法（如 Copeland 法、Minimax 法、Schulze 法等）。

**（2）混合处理单选投票数据**

[findCondorcetWinner 第202-208行](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L202-L208) 同时处理排序投票（`voteData.ranking`）和单选投票（`voteData.option_id`）：
```javascript
if (voteData.option_id) {
  optionIds.forEach(b => {
    if (b !== voteData.option_id) {
      pairWins[voteData.option_id][b] += vote.weight || 1;
    }
  });
}
```
这意味着单选投票中未被选中的选项都被视为"输给"选中的选项，但实际上单选投票者可能并未对其他选项做出偏好判断。这在语义上是不准确的，可能歪曲真实偏好。

**（3）平票处理**

[第218行](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L218) 使用 `aVotes <= bVotes` 判定非赢家：
```javascript
if (aVotes <= bVotes) {
  beatsAll = false;
  break;
}
```
平票时严格认定为"未击败"，这在数学上是正确的（Condorcet 赢家必须严格击败所有对手），但缺少平票时的附加说明或处理策略。

### 1.2 Smith 集计算的正确性

**分析结论：当前 Smith 集算法存在根本性错误，计算的不是真正的 Smith 集，而是"非全败者集合"。**

#### 算法原理对比

**Smith 集的正确定义：** 最小的选项集合 S，使得 S 中的每个选项都能击败 S 之外的每个选项。

**当前算法的问题：**

[findSmithSet 第245-276行](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L245-L276) 使用的算法是"删除输给集合内所有其他人的选项"：
```javascript
while (changed) {
  changed = false;
  for (let i = smithSet.length - 1; i >= 0; i--) {
    const candidate = smithSet[i];
    const others = smithSet.filter(x => x !== candidate);
    
    const beatsAllOthers = others.every(other => beats(candidate, other));
    const losesToAllOthers = others.every(other => beats(other, candidate));
    
    if (!beatsAllOthers && losesToAllOthers && smithSet.length > 1) {
      smithSet.splice(i, 1);
      changed = true;
    }
  }
}
```

#### 反例验证

考虑5个选项 A、B、C、D、E，偏好关系如下：
- D 击败 A、B、C、E（D 是 Condorcet 赢家）
- A 击败 B、E
- B 击败 C、E
- C 击败 A、E
- E 输给所有人

**正确的 Smith 集应为 {D}**（因为 D 击败所有其他选项）。

**当前算法的输出：**
1. 初始集合：[A, B, C, D, E]
2. E 输给所有人 → 删除 E
3. 剩余 [A, B, C, D]
4. A 不输给所有人（A 击败 B）→ 不删除
5. B 不输给所有人（B 击败 C）→ 不删除
6. C 不输给所有人（C 击败 A）→ 不删除
7. D 击败所有人 → 不删除（条件要求 `!beatsAllOthers`）
8. **最终结果：[A, B, C, D]** —— 包含了不应在 Smith 集中的 A、B、C

这证明当前算法无法正确识别 Condorcet 赢家所在的最小 Smith 集。

#### 平票与全等场景

- **全部平票**：所有选项两两平局时，`beats(a, b)` 始终为 false，`losesToAllOthers` 也始终为 false，因此不会删除任何选项，最终 Smith 集包含所有选项。这在结果上是正确的（因为没有选项击败其他选项，Smith 集就是全体），但推导过程的逻辑基础不正确。
- **部分平票**：当部分选项平票时，算法行为取决于具体的偏好结构，可能输出过大的集合。

### 1.3 改进建议

| 问题 | 建议方案 |
|------|---------|
| Condorcet 无回退 | 增加 Copeland 法或 Schulze 法作为回退算法，在无 Condorcet 赢家时自动计算补充结果 |
| 单选数据混入 | 将 Condorcet 计算限定为排序投票类型，或对单选投票采用更保守的处理（仅记录选中选项优于未选项，未选项之间视为平票而非全败） |
| Smith 集算法错误 | 重写 Smith 集算法，使用基于强连通分量（SCC）的正确算法：先构造有向图（边表示击败关系），再用 Kosaraju 或 Tarjan 算法求 SCC，然后取源 SCC 即为 Smith 集 |
| 平票处理文档化 | 在返回结果中增加平票说明，或提供平局决胜规则配置 |

**Smith 集正确实现参考：**
```javascript
function findSmithSetCorrect(votes, options) {
  const optionIds = options.map(o => o.id);
  const condorcet = findCondorcetWinner(votes, options);
  const matrix = condorcet.pairwiseMatrix;
  
  // 构造击败关系图
  const adj = {};
  optionIds.forEach(a => {
    adj[a] = [];
    optionIds.forEach(b => {
      if (a !== b && (matrix[a][b] || 0) > (matrix[b][a] || 0)) {
        adj[a].push(b);
      }
    });
  });
  
  // Kosaraju 算法求强连通分量
  // ... 实现略，最终取源SCC即为Smith集
}
```

---

## 二、Borda 计数积分归一化分析

### 2.1 部分排序下的权重偏差

**分析结论：当投票者仅对部分选项排序时（弃权部分选项），Borda 计数存在系统性权重偏差，未做归一化补偿。**

#### 问题详细分析

[calculateBorda 第53-81行](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L53-L81) 的计分规则：
```javascript
const n = options.length;
// ...
voteData.ranking.forEach((optId, index) => {
  if (results.hasOwnProperty(optId)) {
    const points = (n - 1 - index) * (vote.weight || 1);
    results[optId] += points;
  }
});
```

**权重偏差示例：**

假设总选项数 n=5，标准 Borda 分数分配为 4, 3, 2, 1, 0，每位投票者总权重为 10 分。

| 投票者 | 排序长度 | 实际投出总分 | 权重利用率 |
|--------|---------|-------------|-----------|
| 完整排序者 | 5 | 4+3+2+1+0 = 10 | 100% |
| 部分排序者（排3个） | 3 | 4+3+2 = 9 | 90% |
| 仅投第1名 | 1 | 4 = 4 | 40% |

部分排序的投票者实际上被赋予了更低的有效权重，这与"一人一票"的原则相悖。弃权的选项默认得 0 分，但未排序不代表"最不喜欢"，可能只是"不了解"或"无所谓"。

#### 前端与后端的不一致

在前端 [app.js 第435-450行](file:///Users/huwenjie/项目/gsb/hwj-00489/public/js/app.js#L435-L450) 中，排序投票 UI 强制显示所有选项并要求全部排序：
```javascript
case 'ranked':
  optionsHtml = `
    <div class="rank-option-list" id="rank-list">
      ${activeOptions.map((opt, i) => `
        <div class="rank-option-item" data-id="${opt.id}">
          ...
        </div>
      `).join('')}
    </div>
  `;
```
因此通过正常 UI 提交的投票都是完整排序。但后端算法并未做此校验，直接通过 API 调用可以提交部分排序的投票，导致权重不一致。

### 2.2 选项动态变化场景

当投票进行中选项被淘汰（多轮投票模式）时，Borda 计数基于当前存活选项数计算，这在数学上是正确的。但跨轮次比较分数时会存在不可比性，因为不同轮次的选项数量不同，分数范围也不同。

### 2.3 改进建议

| 问题 | 建议方案 |
|------|---------|
| 部分排序权重偏差 | 增加归一化选项：将部分排序的投票归一化为与完整排序相同的总权重，公式：`归一化系数 = (n-1)*n/2 / (k-1)*k/2`，其中 k 为实际排序数量 |
| 后端缺少校验 | 在投票提交接口增加排序完整性校验，确保排序投票包含所有有效选项 |
| 弃权语义明确 | 提供"未排序选项"的语义配置：是视为最低偏好（当前行为），还是视为平票（平分剩余分数） |

**归一化实现参考：**
```javascript
const k = voteData.ranking.length;
const maxTotal = (n - 1) * n / 2;  // 完整排序的总分数
const actualTotal = (k - 1) * k / 2; // 实际排序的总分数
const normalizeFactor = k < n ? maxTotal / actualTotal : 1;

voteData.ranking.forEach((optId, index) => {
  if (results.hasOwnProperty(optId)) {
    const points = (n - 1 - index) * (vote.weight || 1) * normalizeFactor;
    results[optId] += points;
  }
});
```

---

## 三、匿名投票隐私泄露分析

### 3.1 泄露路径汇总

**分析结论：匿名投票模式存在多处隐私泄露路径，其中热力图接口和稳定性分析的泄露最为严重。**

| 泄露点 | 严重程度 | 泄露内容 | 代码位置 |
|--------|---------|---------|---------|
| 稳定性分析 pivotalVoters | ⚠️ 高 | 关键投票者的用户 ID 列表 | [voting-algorithms.js 第278-312行](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L278-L312) |
| 热力图接口 | ⚠️ 严重 | 每个用户的完整投票内容 | [server.js 第1283-1298行](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L1283-L1298) |
| 投票详情 voted_users | ⚠️ 中 | 已投票用户的身份列表 | [server.js 第245-251行](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L245-L251) |
| 桑基图（小样本） | ⚠️ 低 | 可通过流量大小推断个体 | [voting-algorithms.js 第425-491行](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L425-L491) |

### 3.2 详细分析

**（1）稳定性分析泄露关键投票者**

[analyzeStability 第303行](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L303) 返回 `pivotalVoters` 数组：
```javascript
const pivotalVoters = analyses.filter(a => a.pivotal).map(a => a.voter_id);
```

在 [server.js 第385行](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L385)，该数据被无条件返回到 `advanced_analysis.stability` 中，即使 `poll.is_anonymous` 为 true：
```javascript
stability = analyzeStability(votes, options.filter(o => !o.eliminated), poll.type);
```

虽然没有直接泄露投票内容，但泄露了"哪些用户的投票可以改变结果"这一敏感信息。在小范围投票中，结合其他信息可以推断出投票倾向。

**（2）热力图接口完全泄露投票内容**

[server.js 第1283-1298行](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L1283-L1298) 的热力图接口：
```javascript
app.get('/api/polls/:id/visualization/heatmap', authenticateToken, (req, res) => {
  // ... 没有任何 is_anonymous 检查
  const voters = db.prepare(`
    SELECT DISTINCT u.id, u.display_name, u.username
    FROM votes v JOIN users u ON v.user_id = u.id
    WHERE v.poll_id = ? AND v.round = ?
  `).all(pollId, poll.current_round);

  const heatmap = calculateScoreMatrix(poll, votes, options, voters);
  res.json(heatmap);
});
```

该接口完全没有检查 `poll.is_anonymous` 标志，直接返回包含用户标签的完整投票矩阵。任何有权查看投票结果的用户都可以看到每个人投了什么票，这完全破坏了匿名投票的隐私保护。

[calculateScoreMatrix 第386-423行](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L386-L423) 明确按用户维度构建矩阵：
```javascript
users.forEach(user => {
  userLabels.push(user.display_name || user.username);
  // ... 逐行填充每个用户的投票数据
});
return { matrix, optionLabels, userLabels };
```

**（3）投票详情泄露投票者身份**

[server.js 第245-251行](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L245-L251)：
```javascript
const votedUsers = db.prepare(`
  SELECT DISTINCT v.user_id, u.display_name, u.username
  FROM votes v
  JOIN users u ON v.user_id = u.id
  WHERE v.poll_id = ? AND v.round = ?
`).all(pollId, poll.current_round);
poll.voted_users = votedUsers;
```

即使是匿名投票，用户也能看到"谁投了票"，只是看不到"投了什么"。在某些场景下（如小范围敏感投票），投票行为本身也是敏感信息。

**（4）创建者权限绕过**

[server.js 第391行](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L391) 的逻辑：
```javascript
if (!poll.is_anonymous || poll.creator_id === req.user.id) {
  individualVotes = db.prepare(...).all(...);
}
```
创建者即使在匿名投票中也能看到所有个人投票记录。虽然创建者通常有管理权限，但这与"匿名"的语义不符，应明确告知用户创建者可查看投票内容。

### 3.3 改进建议

| 泄露点 | 改进方案 |
|--------|---------|
| 稳定性分析 | 匿名投票时移除 `pivotalVoters` 字段，或仅返回数量而不返回具体 ID |
| 热力图接口 | 增加 `is_anonymous` 检查，匿名投票时不返回用户标签或完全禁用热力图 |
| voted_users 列表 | 匿名投票时隐藏 voted_users，或提供配置项控制是否显示投票者身份 |
| 创建者权限 | 在创建投票时明确提示"创建者可查看匿名投票内容"，或增加"完全匿名"模式使创建者也无法查看 |
| 桑基图 | 小样本（如少于5个投票者）时禁用桑基图，避免通过流量推断个体 |

---

## 四、加权分配算法边界行为分析

### 4.1 权重总和为零

**分析结论：权重总和为零时做了除零保护，但 winner 选取逻辑不明确。**

[calculateWeightedAllocation 第138-144行](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L138-L144)：
```javascript
const totalAllocated = Object.values(results).reduce((a, b) => a + b, 0);
// ...
percentage: totalAllocated > 0 ? +((score / totalAllocated) * 100).toFixed(2) : 0,
```

**问题：**
- 当 `totalAllocated === 0` 时，所有选项的 percentage 都为 0，这是安全的
- 但 winner 仍然取排序后的第一个（[第151行](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L151)）：`winner: sorted[0]?.option_id`
- 由于所有选项得分均为 0，排序取决于 `Object.entries(results)` 的遍历顺序，即选项 ID 的插入顺序，这是不确定且不公平的

### 4.2 权重总和为负数

**分析结论：完全未处理负分配值和负权重，可能导致异常结果。**

#### 负分配值

后端投票接口 [server.js 第258-320行](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L258-L320) 未对 `vote_data.allocations` 中的数值做任何合法性校验。用户可通过 API 直接提交负数：

```javascript
// 攻击者可提交: { allocations: { "1": -100, "2": 200 } }
```

后果：
- 某些选项得分为负
- `totalAllocated` 可能为正、负或零
- 百分比计算：`totalAllocated > 0 ? ... : 0`，当 totalAllocated < 0 时百分比为 0，但得分为负
- 排名可能出现反转（负分越多排名越靠后）

#### 负用户权重

用户表的 weight 字段为 `REAL DEFAULT 1`（[database.js 第17行](file:///Users/huwenjie/项目/gsb/hwj-00489/database.js#L17)），没有非负约束。

代码中权重使用方式：`vote.weight || 1`（[voting-algorithms.js 第9行](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L9) 等多处）
- weight 为 0 时，`0 || 1` 结果为 1（正确，避免零权重）
- weight 为负数时，负数是 truthy 值，会直接使用负权重
- 负权重会导致"投票反对"效果：给某选项投票反而降低其得分

### 4.3 其他边界场景

| 场景 | 当前行为 | 问题 |
|------|---------|------|
| 单选项投票 | 唯一选项获得所有分配，得分为分配总和 | 无实际意义但无害 |
| 弃权投票 | is_abstain 为 true 时跳过，不计入 | 正确 |
| 分配值非数字 | JSON 解析后可能为 NaN，导致结果为 NaN | 排序和显示异常 |
| 部分选项未分配 | 未分配的选项得 0 分 | 合理，但应明确是"0分"还是"弃权" |

### 4.4 前后端校验不一致

前端 [app.js 第658-671行](file:///Users/huwenjie/项目/gsb/hwj-00489/public/js/app.js#L658-L671) 有总和校验：
```javascript
if (total !== 100) {
  this.showToast('权重总和必须等于100分', 'error');
  return;
}
```

但后端 [server.js 第258-320行](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L258-L320) 完全没有校验，直接存储提交的 vote_data。这使得前端校验形同虚设，可通过 API 绕过。

### 4.5 改进建议

| 问题 | 改进方案 |
|------|---------|
| 总和为零的 winner | 当 totalAllocated === 0 时，将 winner 设为 null，表示无有效获胜者 |
| 负分配值 | 后端增加校验：所有分配值必须 >= 0，且总和必须等于 100（或配置值） |
| 负权重 | 数据库层增加 weight >= 0 约束，代码中使用 `Math.max(0, vote.weight || 0)` 确保非负 |
| NaN 防护 | 增加 `isNaN` 检查，过滤非法数值 |
| 后端校验一致性 | 对所有投票类型都增加后端数据校验，不可仅依赖前端校验 |

**加权分配校验参考：**
```javascript
function validateWeightedAllocation(voteData, options) {
  if (!voteData.allocations || typeof voteData.allocations !== 'object') {
    return { valid: false, error: '分配数据格式错误' };
  }
  
  let total = 0;
  for (const [optId, amount] of Object.entries(voteData.allocations)) {
    if (typeof amount !== 'number' || isNaN(amount) || amount < 0) {
      return { valid: false, error: `选项 ${optId} 的分配值非法` };
    }
    total += amount;
  }
  
  if (Math.abs(total - 100) > 0.01) {
    return { valid: false, error: `分配总和必须为100，当前为 ${total}` };
  }
  
  return { valid: true };
}
```

---

## 总结与优先级建议

### 高优先级修复（安全性）

1. **修复热力图匿名泄露** —— 直接暴露所有用户投票内容，严重违反匿名承诺
2. **修复稳定性分析泄露** —— 匿名投票不应返回具体 pivotalVoter ID
3. **增加后端投票数据校验** —— 防止通过 API 提交恶意数据（负分配、非法格式等）

### 中优先级修复（正确性）

4. **重写 Smith 集算法** —— 当前算法结果错误，影响高级分析可信度
5. **Condorcet 增加回退策略** —— 无赢家时提供替代决策方法
6. **Borda 部分排序归一化** —— 确保不同完整度的投票权重一致

### 低优先级改进（健壮性）

7. **负权重防护** —— 数据库和代码层增加非负约束
8. **零总和 winner 处理** —— 无有效分配时明确返回无赢家
9. **创建者匿名权限文档化** —— 明确告知用户创建者可查看匿名投票
