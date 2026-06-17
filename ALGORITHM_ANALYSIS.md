# 投票算法正确性与健壮性分析报告

## 概述

本报告对在线决策投票应用的核心投票算法进行了全面分析，覆盖 Condorcet 方法、Borda 计数、匿名投票隐私保护以及加权分配算法四个维度。分析基于 `voting-algorithms.js`、`server.js` 和 `public/js/app.js` 中的实际实现。

---

## 一、Condorcet 方法与 Smith 集分析

### 1.1 Condorcet 赢家判定

**代码位置**：[findCondorcetWinner](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L176-L243)

#### 分析结论

**基本逻辑正确，但存在以下问题：**

1. **无 Condorcet 赢家时完全没有回退机制**
   - 当出现循环偏好（A > B > C > A）时，函数仅返回 `hasWinner: false`，不提供任何替代方案
   - 在 [server.js](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L377-L388) 的结果接口中，Condorcet 结果仅作为"高级分析"展示，对最终决策无实际影响
   - 系统缺乏 Copeland、Schulze（排序对）、Minimax 等标准 Condorcet 补全方法

2. **单选投票的两两比较假设过强**
   - 第 202-208 行：单选投票 (`voteData.option_id`) 被视为所选选项击败所有其他选项
   - 问题：单选投票仅表达了第一偏好，并未表达对其他选项的排序，将其等同于"所选选项优于全部其他选项"可能扭曲结果

3. **平票判定使用严格大于**
   - 第 218 行：`if (aVotes <= bVotes)` 意味着严格大于才算击败
   - 平票时两个选项互相都不"击败"对方，这在数学上正确，但导致 Condorcet 赢家更难产生

#### 改进建议

```
建议新增以下回退机制之一（按推荐优先级排序）：
1. Schulze 方法（最通用，满足多数 Condorcet 标准）
2. Smith 集 + Borda 计数（仅对 Smith 集内选项计算 Borda 得分）
3. Copeland 方法（击败数减去被击败数）
4. Minimax（最小化最大败差）
```

### 1.2 Smith 集计算

**代码位置**：[findSmithSet](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L245-L276)

#### 算法逻辑

当前实现采用迭代移除"被所有其他选项击败的候选者"的自底向上策略：
- 初始 Smith 集包含所有选项
- 循环检查每个候选者：如果该候选者输给集合中所有其他候选者，则移除
- 直到无法再移除任何候选者

#### 分析结论

**平票场景（tie）：基本正确**
- `beats` 函数使用严格大于比较（第 250 行）
- 当两个候选者平票时，互相都不击败对方
- 因此平票的候选者不会被判定为"输给所有人"，会保留在 Smith 集中
- 这符合广义 Smith 集的定义

**全等场景（all tie）：正确**
- 所有候选者互相平票时，无人被移除
- Smith 集 = 全部候选者
- 符合预期

**标准场景：算法正确性存疑**

当前算法只移除"输给集合中所有其他选项"的候选者（即 Condorcet 输家）。这在层级分明的投票中有效，但在复杂循环结构中可能无法正确收敛到最小 Smith 集。

**潜在问题示例**：考虑 4 个选项 A、B、C、D，其中 A 击败 B 和 C，B 击败 C 和 D，C 击败 D，D 击败 A。此情况下：
- 没有选项输给所有其他选项
- 算法直接返回全部 4 个选项
- 实际上 Smith 集确实是全部 4 个（因为存在包含所有选项的循环），此例中结果正确

但更复杂的嵌套循环场景下，仅移除"全败者"的策略可能不充分。标准 Smith 集计算应使用图论中的强连通分量（SCC）算法（如 Tarjan 或 Kosaraju），而非简单迭代。

#### 改进建议

```javascript
// 建议使用基于强连通分量的标准 Smith 集计算
function findSmithSet(votes, options) {
  const condorcet = findCondorcetWinner(votes, options);
  const matrix = condorcet.pairwiseMatrix;
  const optionIds = options.map(o => o.id);
  
  // 使用 Tarjan 算法找击败关系图中的 SCC
  // 顶部 SCC 即为 Smith 集
  // ...
}
```

---

## 二、Borda 计数归一化偏差分析

**代码位置**：[calculateBorda](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L53-L81)

### 2.1 核心逻辑

```
n = options.length（选项总数）
第 i 名得分为 (n - 1 - i) * weight
即第一名得 n-1 分，第二名得 n-2 分，...，最后一名得 0 分
```

### 2.2 分析结论

**问题 1：部分排序（弃权部分选项）导致投票权重不等**

- 第 62-67 行：仅对出现在 `voteData.ranking` 数组中的选项计分
- 未被排序的选项得 0 分
- 这意味着对 n 个选项只排了 k 个的选民，其选票总贡献为 k(k-1)/2 分
- 而完整排序的选民贡献 n(n-1)/2 分
- **偏差**：排序选项越少的选民，对结果的影响力越小

**示例**：5 个选项，选民 A 排全部 5 个（总贡献 10 分），选民 B 只排前 2 个（总贡献 7 分）。B 的投票权重仅为 A 的 70%。

**问题 2：后端不校验排序完整性**

- 前端 [app.js](file:///Users/huwenjie/项目/gsb/hwj-00489/public/js/app.js#L643-L646) 对排序投票总是提交所有选项的完整排名
- 但后端无校验，API 调用者可提交部分排名
- 这可能被利用来操纵选举结果

**问题 3：多轮淘汰中选项数变化的处理**

- 第 158 行：`calculateResults` 使用 `activeOptions`（未被淘汰的选项）
- Borda 计数基于当前轮次的活跃选项数重新计算
- 这在多轮淘汰制中是正确的——每轮都用当前选项集重新计票

### 2.3 改进建议

```
1. 后端增加排序完整性校验：
   - 验证 ranking 数组包含所有活跃选项
   - 验证无重复选项
   - 验证选项 ID 有效性

2. 如需支持部分排序，应进行归一化：
   - 方式 A：按比例缩放，使每张选票总权重相等
   - 方式 B：未排名选项平均分配剩余分数
   - 方式 C：仅对有排名的选项归一化（推荐）

3. 归一化示例（方式 C）：
   设某选民排名了 k 个选项，共 n 个选项
   原总分为 k(k-1)/2
   归一化系数 = n(n-1)/2 / [k(k-1)/2] = n(n-1)/[k(k-1)]
   每个排名选项得分 *= 归一化系数
```

---

## 三、匿名投票模式隐私泄露分析

### 3.1 泄露路径汇总

| 泄露路径 | 严重程度 | 代码位置 | 泄露内容 |
|---------|---------|---------|---------|
| 创建者始终可见全部选票 | 高 | [server.js L391](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L391-L403) | 所有用户的完整投票内容 |
| 稳定性分析泄露关键选民 ID | 高 | [server.js L385](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L385) | 关键投票者的用户 ID 列表 |
| 热力图接口泄露完整投票矩阵 | 极高 | [server.js L1283-L1298](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L1283-L1298) | 每个用户对每个选项的具体评分/排序 |
| 投票参与人列表始终公开 | 中 | [server.js L245-L253](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L245-L253) | 哪些用户参与了投票 |
| 桑基图可能泄露跨轮投票模式 | 中 | [server.js L1300-L1323](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L1300-L1323) | 多轮投票中的用户流动模式 |

### 3.2 详细分析

#### 泄露 1：创建者权限绕过匿名保护

**位置**：[server.js L391](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L391-L403)

```javascript
if (!poll.is_anonymous || poll.creator_id === req.user.id) {
  individualVotes = db.prepare(...).all(...);
}
```

- 即使 `is_anonymous` 为 true，创建者仍可查看所有个人投票
- 响应中的 `can_see_votes` 字段明确标示了此逻辑
- **问题**：这使得"匿名投票"对创建者形同虚设
- 若为设计需求，应在 UI 中明确告知投票者"投票对创建者可见"

#### 泄露 2：稳定性分析泄露选民身份

**位置**：[analyzeStability](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L278-L312)

```javascript
analyses.push({
  voter_id: vote.user_id,
  pivotal: resultChanges
});
// ...
pivotalVoters: pivotalVoters.map(a => a.voter_id),
```

- `analyzeStability` 返回 `pivotalVoters` 数组，包含所有关键选民的 `user_id`
- 此数据通过结果接口的 `advanced_analysis.stability` 字段返回给所有已认证用户
- **在匿名投票中，关键选民身份完全暴露**
- 特别是在小样本投票中，可能通过"谁是关键选民"反推出投票内容

#### 泄露 3：热力图接口完全绕过匿名保护

**位置**：[server.js L1283-L1298](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L1283-L1298)

```javascript
app.get('/api/polls/:id/visualization/heatmap', authenticateToken, (req, res) => {
  // ... 直接查询所有投票者及其投票内容 ...
  const heatmap = calculateScoreMatrix(poll, votes, options, voters);
  res.json(heatmap);
});
```

- 热力图接口**完全没有**检查 `poll.is_anonymous`
- 返回 `userLabels`（用户姓名）和 `matrix`（完整投票矩阵）
- 这是最严重的泄露——匿名投票中所有用户的具体投票内容一览无余
- [calculateScoreMatrix](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L386-L423) 函数逐人解析投票数据，无任何脱敏

#### 泄露 4：参与人列表始终公开

**位置**：[server.js L245-L253](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L245-L253)

```javascript
poll.voted_users = votedUsers;
```

- 投票详情接口始终返回 `voted_users` 列表（显示名、用户名）
- 虽然不直接泄露投票内容，但泄露了"谁参与了投票"
- 在敏感场景（如内部举报、人事投票）中，参与人信息本身就是敏感数据

### 3.3 改进建议

```
1. 热力图接口增加匿名检查：
   - 匿名模式下，隐藏 userLabels 或使用随机 ID 替代
   - 或仅对创建者显示（与 individual_votes 逻辑一致）

2. 稳定性分析匿名化：
   - 匿名模式下不返回 pivotalVoters 列表
   - 或仅返回 pivotalVoterCount 数量

3. 明确创建者权限：
   - 若设计上创建者应可见所有内容，需在 UI 中显著提示
   - 考虑增加"完全匿名"模式，创建者也不可见

4. 参与人列表保护：
   - 匿名模式下隐藏 voted_users 列表
   - 或仅显示参与人数，不显示具体名单

5. 桑基图数据脱敏：
   - 匿名模式下移除可识别个人的维度
   - 仅保留聚合的流动数据
```

---

## 四、加权分配算法边界行为分析

**代码位置**：[calculateWeightedAllocation](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L121-L155)

### 4.1 核心逻辑

```
每个选项得分 = Σ (分配金额 * 投票者权重)
百分比 = 选项得分 / 总分配额 * 100%
```

### 4.2 边界场景分析

#### 场景 1：所有权重之和为零

**触发条件**：所有投票者的 `weight` 均为 0
- 每张选票贡献为 `amount * 0 = 0`
- `totalAllocated = 0`
- 第 143 行：`totalAllocated > 0` 为 false，所有选项 `percentage = 0`
- **行为**：所有得分和百分比均为 0，仍返回第一个选项作为"赢家"
- **问题**：无意义的"赢家"可能误导用户

#### 场景 2：权重总和为负数

**触发条件**：部分投票者权重为负，且负值总和超过正值总和
- `totalAllocated` 可能为负数
- `totalAllocated > 0` 为 false → 所有百分比为 0
- 但实际 `score` 可能为负值
- **问题**：百分比全部为 0 但实际得分为负，数据不一致

#### 场景 3：单个负权重用户

**触发条件**：存在权重为负的用户
- 该用户的分配金额会从总分中**减去**
- 可能导致选项得分为负
- 可能导致排名反转（分配越多反而得分越低）
- **问题**：与用户直觉相悖，且无任何校验阻止负权重

#### 场景 4：分配金额为负

**触发条件**：用户提交负的分配值（通过 API）
- 前端 `input[type=number]` 有 `min="0"`，但后端不校验
- 负金额会降低选项总分
- **问题**：可被用于操纵结果

#### 场景 5：总分配额为零（全零分配）

**触发条件**：所有用户对所有选项分配 0 分
- 行为与"零权重"类似：所有百分比为 0
- `totalAllocated = 0` → `percentage = 0`
- 这是合理的边界处理

#### 场景 6：浮点精度问题

- 使用 `.toFixed(2)` 进行舍入
- 排序在 `.toFixed()` 之前进行（第 146 行），避免了舍入导致排序错误
- 但存储和展示时可能存在微小的累计误差

#### 场景 7：非数值输入

- 若 `amount` 为非数值（如字符串 `null`），`amount * vote.weight` 会得到 `NaN`
- `NaN` 会污染整个 `results[id]` 的累加
- 可能导致 `totalAllocated` 为 `NaN`，进而所有百分比为 0

### 4.3 权重赋值逻辑

**位置**：[server.js L361-L368](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L361-L368)

```javascript
if (poll.weighted_voting) {
  votes = votes.map(vote => {
    const user = db.prepare('SELECT weight FROM users WHERE id = ?').get(vote.user_id);
    return { ...vote, weight: user?.weight || 1 };
  });
} else {
  votes = votes.map(vote => ({ ...vote, weight: 1 }));
}
```

- 用户表中 `weight` 字段默认为 1（[database.js L17](file:///Users/huwenjie/项目/gsb/hwj-00489/database.js#L17)）
- 无任何校验确保 `weight > 0`
- 管理员可通过直接修改数据库设置任意权重值

### 4.4 改进建议

```
1. 输入校验：
   - 验证分配金额非负
   - 验证所有权重为正数
   - 验证总分配额 > 0（或至少非负）

2. 零/负边界处理：
   - 若 totalAllocated <= 0，返回明确的错误状态或警告
   - 赢家字段在无有效数据时应为 null 而非第一个元素

3. NaN 防护：
   - 使用 Number.isFinite() 检查数值有效性
   - 跳过无效数据而非污染结果

4. 数据库层约束：
   - 为 users.weight 添加 CHECK(weight > 0) 约束
   - 提供权重管理 API 时做范围校验

5. 前端验证加强：
   - 虽然前端有 min="0"，但不应作为唯一防线
```

---

## 总结与优先级建议

| 维度 | 严重问题数 | 最高优先级修复 |
|-----|-----------|--------------|
| Condorcet / Smith 集 | 2 | 为无 Condorcet 赢家场景增加 Schulze 或 Copeland 回退 |
| Borda 归一化 | 2 | 后端增加排序完整性校验，防止部分排名绕过 |
| 匿名投票隐私 | 4 | **热力图接口**增加匿名检查（最严重泄露） |
| 加权分配边界 | 4 | 增加非负权重校验和 NaN 防护 |

### 最高优先行动项

1. **立即修复**：热力图接口匿名检查（[server.js L1283](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js#L1283)）——这是最严重的安全漏洞
2. **立即修复**：稳定性分析匿名化（[voting-algorithms.js L303](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js#L303)）——泄露关键选民身份
3. **近期修复**：后端投票数据校验（所有算法均缺乏输入验证）
4. **中期改进**：Condorcet 回退机制和 Smith 集标准算法
