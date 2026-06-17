# 投票算法正确性与健壮性分析报告

> 分析范围：`voting-algorithms.js`、`server.js`、`public/js/app.js`
> 分析日期：2026-06-17

---

## 一、Condorcet 方法：循环偏好回退逻辑与 Smith 集计算

### 1.1 Condorcet 赢家检测

**代码位置**：[voting-algorithms.js](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js) 第 176–243 行 `findCondorcetWinner`

**分析结论**：Condorcet 赢家检测逻辑本身正确，但在循环偏好（无 Condorcet 赢家）时缺乏有效的回退决策机制。

**具体问题**：

1. **回退逻辑缺失**：当出现 Condorcet 循环（如 A>B>C>A）时，`findCondorcetWinner` 仅返回 `hasWinner: false`，不提供任何回退赢家。该函数仅作为"高级分析"附加信息展示（[server.js](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js) 第 382–387 行），不影响实际排名结果。对于 `ranked` 类型投票，实际排名始终由 Borda 计数决定（[voting-algorithms.js](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js) 第 165–166 行），Condorcet 分析仅作参考。这意味着当 Borda 赢家与 Condorcet 赢家不一致时，系统没有任何警告或冲突提示。

2. **平票判定过于严格**：第 218 行 `if (aVotes <= bVotes)` 使用严格大于判定，即任何一对平票都会导致候选人不被视为 Condorcet 赢家。当投票人数为偶数时，出现平票的概率较高，这会过度倾向于"无 Condorcet 赢家"的结论。部分 Condorcet 变体（如 Schulze 方法）允许在平票时仍认定一方优势。

3. **单选投票的偏好构造不合理**：第 202–208 行，对于单选投票（`voteData.option_id`），代码将所选选项视为优于所有其他选项。这在 Condorcet 语义上是不准确的——单选投票只表达了"最偏好"，并未表达其余选项间的相对偏好，将其展开为完全偏好序会引入虚假的偏好强度。

### 1.2 Smith 集计算

**代码位置**：[voting-algorithms.js](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js) 第 245–276 行 `findSmithSet`

**分析结论**：Smith 集计算算法存在**严重逻辑错误**，在多种常见场景下会返回错误结果。

**算法逻辑回顾**：

当前实现采用"逐步剔除"策略——从全部候选集出发，反复移除"在当前集合内输给所有其他候选人"的候选人，直到无法继续移除。

**Smith 集的正确定义**：最小的非空集合 S，使得 S 中每个成员在两两比较中击败 S 外的所有成员。

**关键缺陷**：当前算法只移除"输给集合内所有人"的候选人，但这只是 Condorcet 输家的特征，并非 Smith 集缩减的正确判据。当存在 Condorcet 赢家时，算法无法正确将非 Smith 集成员剔除。

**反例**：

考虑 4 个候选人 A、B、C、D，偏好关系为：
- A 击败 B、C、D（A 是 Condorcet 赢家）
- B 击败 D，但输给 A、C
- C 击败 B、D，但输给 A
- D 输给 A、B、C

正确的 Smith 集 = {A}（A 击败所有其他人）。

当前算法执行过程：
1. 初始集合 = {A, B, C, D}
2. D 输给 A、B、C → D 不输给"所有其他人"（D 输给 A、B、C，即输给全部）→ 移除 D ✓
3. B 输给 A、C → B 不输给"所有其他人"（B 击败 D，但 D 已被移除，当前集合为 {A, B, C}，B 输给 A 和 C，即输给所有当前集合内其他人）→ 移除 B ✓
4. C 输给 A → C 不输给"所有其他人"（C 击败 B，但 B 已被移除，当前集合为 {A, C}，C 输给 A，即输给所有当前集合内其他人）→ 移除 C ✓
5. 结果 = {A} ✓

此例正确。但考虑更微妙的情况：

5 个候选人 A、B、C、D、E：
- A 击败 D、E；B 击败 D、E；C 击败 D、E
- A 击败 B，B 击败 C，C 击败 A（前三名形成循环）
- D 击败 E

正确 Smith 集 = {A, B, C}（三人各自击败 D 和 E）。

当前算法：
1. E 输给 A、B、C、D → 移除 E ✓
2. D 输给 A、B、C → 移除 D ✓
3. {A, B, C}：A 输给 C，但不输给 B；B 输给 A，但不输给 C；C 输给 B，但不输给 A → 无人输给所有其他人 → 停止
4. 结果 = {A, B, C} ✓

再考虑一个失败案例：

4 个候选人 A、B、C、D：
- A 击败 B、C、D
- B 击败 D
- C 击败 B、D
- D 击败 C

正确 Smith 集 = {A}。

当前算法：
1. B 输给 A、C，但 B 击败 D → B 不输给所有其他人 → 不移除
2. C 输给 A，但 C 击败 B、D → C 不输给所有其他人 → 不移除
3. D 输给 A、B，但 D 击败 C → D 不输给所有其他人 → 不移除
4. 结果 = {A, B, C, D} ❌（正确答案应为 {A}）

**结论**：当存在 Condorcet 赢家且非赢家之间存在复杂的胜负关系时，算法无法正确缩减 Smith 集。

### 1.3 平票与全等场景

**平票场景**：`beats` 函数（第 250 行）使用严格大于 `(matrix[a][b] || 0) > (matrix[b][a] || 0)`，平票时双方互不"击败"。在 Smith 集计算中，这意味着平票不会触发移除条件，候选人会被保守保留。这在某些场景下是合理的，但在平票普遍存在时（如投票人极少），Smith 集会过大。

**全等场景**：当所有选项在所有两两比较中完全平票（如所有投票人弃权或给出完全一致的排名），矩阵全为零，无人击败任何人，也无人输给任何人。Smith 集算法将保留所有选项，结果正确。

### 1.4 改进建议

| 问题 | 建议 |
|------|------|
| Condorcet 无赢家时无回退 | 实现 Schulze 方法或 Ranked Pairs 作为 Condorcet 回退；或在无 Condorcet 赢家时从 Smith 集内用 Borda 计数选出赢家 |
| Smith 集算法错误 | 改用正确的 Smith 集算法：对每个候选子集检查是否满足"集合内所有成员击败集合外所有成员"，取最小满足条件的集合。推荐实现基于有向图的强连通分量（SCC）算法，时间复杂度 O(n²) |
| 平票判定过严 | 可考虑在 `aVotes === bVotes` 时引入平票打破规则（如参考 Borda 得分） |
| 单选投票的偏好展开 | 对单选投票不应展开为完全偏好序，或至少在 Condorcet 分析中标注数据来源的局限性 |

---

## 二、Borda 计数：选项数量动态变化时的积分归一化偏差

### 2.1 当前实现

**代码位置**：[voting-algorithms.js](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js) 第 53–81 行 `calculateBorda`

核心积分公式（第 64 行）：

```javascript
const points = (n - 1 - index) * (vote.weight || 1);
```

其中 `n = options.length`（第 54 行），`index` 为选项在 `voteData.ranking` 数组中的位置。

### 2.2 问题分析

**问题一：部分排名（弃权部分选项）导致投票权重不均等**

当前实现中，`n` 固定为选项总数，但 `voteData.ranking` 的长度可能小于 `n`（投票人只排了部分选项）。未排名的选项不会出现在 `ranking` 数组中，因此自动获得 0 分。

**量化示例**：

假设 5 个选项（n=5），投票人 X 只排了前 3 名：

| 排名位置 | X 的得分 | 完整排名者 Y 的得分 |
|----------|----------|---------------------|
| 第 1 名 | 4 | 4 |
| 第 2 名 | 3 | 3 |
| 第 3 名 | 2 | 2 |
| 第 4 名（未排） | 0 | 1 |
| 第 5 名（未排） | 0 | 0 |
| **总积分** | **9** | **10** |

X 的总积分（9）少于 Y 的总积分（10），但 X 的前 3 名获得了与 Y 完全相同的分数。这意味着 X 通过"弃权"底部选项，将更多相对权重集中在顶部选项上——X 的第 1 名占其总积分的 4/9 ≈ 44.4%，而 Y 的第 1 名占 4/10 = 40%。

**问题二：多轮淘汰后 n 值未动态调整**

在多轮投票中，被淘汰的选项通过 `options.filter(o => !o.eliminated)` 过滤（[voting-algorithms.js](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js) 第 158 行），`n` 会随淘汰自动减小。但已提交的 `ranking` 数组仍包含被淘汰选项的 ID，这些 ID 在第 63 行的 `results.hasOwnProperty(optId)` 检查中被过滤掉（因为 `results` 只包含活跃选项），所以被淘汰选项不会获得积分。这部分逻辑是正确的。

然而，如果投票人的 `ranking` 中被淘汰选项排在前位，后续选项的 `index` 值不会重新计算，导致这些选项的 Borda 分数偏低。例如，排名 [A, B, C] 中 B 被淘汰后，C 的 index 仍为 2，得分为 n-1-2，而非重新计算后的 n-2-1。

**问题三：前端不强制完整排名**

[public/js/app.js](file:///Users/huwenjie/项目/gsb/hwj-00489/public/js/app.js) 第 644–645 行，排名投票提交时直接读取 DOM 中所有 `.rank-option-item` 的 `data-id`，前端始终提交完整排名。因此当前端正常工作时，部分排名不会发生。但后端没有校验 `ranking.length === n`，恶意请求可以提交不完整的排名来操纵结果。

### 2.3 改进建议

| 问题 | 建议 |
|------|------|
| 部分排名导致权重不均等 | 实现归一化 Borda：每个投票人的积分总和应恒定为 `n(n-1)/2`。若投票人只排了 k 个选项，可按比例缩放：`normalizedPoints = points * n(n-1) / (k(2n-k-1))`，或对未排名选项赋予平均剩余分数 `(0 + 1 + ... + (n-k-1)) / (n-k)` |
| 后端未校验排名完整性 | 在 `calculateBorda` 中增加校验：若 `ranking.length < n`，要么拒绝该投票，要么对未排名选项赋予平均分 |
| 淘汰后 index 未重算 | 在计算 Borda 分数前，先从 `ranking` 中移除已淘汰选项，再基于剩余选项重新计算 index |

---

## 三、匿名投票模式下的投票内容泄露路径

### 3.1 泄露路径总览

| 严重程度 | 泄露路径 | 代码位置 | 泄露内容 |
|----------|----------|----------|----------|
| **严重** | 导出接口无视匿名标志 | [server.js](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js) 第 590–631 行 | 投票者姓名 + 完整投票内容 |
| **严重** | 热力图接口无视匿名标志 | [server.js](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js) 第 1283–1298 行 | 投票者姓名 + 逐项评分/排名 |
| **中等** | 稳定性分析暴露关键投票者 ID | [voting-algorithms.js](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js) 第 303–305 行 | 关键投票者的 user_id |
| **中等** | 投票详情接口暴露已投票者名单 | [server.js](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js) 第 245–253 行 | 已投票者姓名列表 |
| **低** | 审计日志暴露投票行为时序 | [server.js](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js) 第 530–554 行 | 谁在何时投票/修改 |

### 3.2 严重泄露：导出接口

**代码位置**：[server.js](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js) 第 556–713 行 `GET /api/polls/:id/export`

第 590–596 行查询所有投票记录并关联用户姓名：

```javascript
const individualVotes = db.prepare(`
  SELECT v.*, u.display_name, u.username
  FROM votes v
  JOIN users u ON v.user_id = u.id
  WHERE v.poll_id = ? AND v.round = ?
  ORDER BY v.created_at
`).all(pollId, poll.current_round);
```

第 614–631 行将每个投票者的姓名与其完整投票内容（包括排名、评分、分配等）渲染到 HTML 表格中。此过程**完全没有检查 `poll.is_anonymous` 标志**。第 695–701 行的匿名判断仅控制 HTML 模板中是否显示"详细投票记录"区块，但 `individualVotes` 数据和 `votesHtml` 变量已在之前无条件生成。

**影响**：投票创建者（且仅创建者可访问此接口）可以导出匿名投票的完整个人投票记录，完全绕过匿名保护。

### 3.3 严重泄露：热力图可视化接口

**代码位置**：[server.js](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js) 第 1283–1298 行 `GET /api/polls/:id/visualization/heatmap`

第 1290–1294 行获取投票者身份信息：

```javascript
const voters = db.prepare(`
  SELECT DISTINCT u.id, u.display_name, u.username
  FROM votes v JOIN users u ON v.user_id = u.id
  WHERE v.poll_id = ? AND v.round = ?
`).all(pollId, poll.current_round);
```

第 1296 行调用 `calculateScoreMatrix(poll, votes, options, voters)`，该函数（[voting-algorithms.js](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js) 第 386–423 行）将每个投票者的 `display_name` 作为行标签，与每个选项的评分/排名组成矩阵返回。

**影响**：任何有权限访问该投票的用户（不仅是创建者）都可以通过热力图接口看到每个投票者对每个选项的具体评分，匿名投票完全失效。

### 3.4 中等泄露：稳定性分析中的关键投票者 ID

**代码位置**：[voting-algorithms.js](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js) 第 278–312 行 `analyzeStability`

第 303–305 行返回 `pivotalVoters` 数组，包含关键投票者的 `user_id`。此数据通过结果接口（[server.js](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js) 第 424 行 `advanced_analysis.stability`）返回给所有有权查看结果的用户，不区分匿名/非匿名。

**影响**：在匿名投票中，知道哪些投票者是"关键投票者"可以缩小推断范围——如果某关键投票者撤回投票会改变结果，结合投票者已知偏好，可推断其投票内容。

### 3.5 中等泄露：已投票者名单

**代码位置**：[server.js](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js) 第 245–253 行

`GET /api/polls/:id` 接口始终返回 `voted_users` 列表（包含 `user_id, display_name, username`），不检查匿名标志。虽然这不直接暴露投票内容，但在投票者人数较少时，知道"谁投了票"结合汇总结果，可能通过排除法推断个人投票。

### 3.6 改进建议

| 泄露路径 | 建议 |
|----------|------|
| 导出接口 | 在导出逻辑中增加 `is_anonymous` 检查：匿名投票导出时脱敏处理（移除投票者姓名，用"投票者 #1, #2..."替代），或不导出个人记录 |
| 热力图接口 | 匿名投票时，行标签使用脱敏标识替代真实姓名；或对匿名投票直接拒绝返回热力图数据 |
| 稳定性分析 | 匿名投票时，`pivotalVoters` 应仅返回关键投票者数量，不返回 `user_id` 列表 |
| 已投票者名单 | 匿名投票时，`voted_users` 仅返回投票人数统计，不返回具体姓名和 ID |
| 审计日志 | 匿名投票的审计日志对非创建者应隐藏 `user_id` 关联信息 |

---

## 四、加权分配算法：权重总和为零或负数时的边界行为

### 4.1 当前实现

**代码位置**：[voting-algorithms.js](file:///Users/huwenjie/项目/gsb/hwj-00489/voting-algorithms.js) 第 121–155 行 `calculateWeightedAllocation`

关键逻辑：

```javascript
const totalAllocated = Object.values(results).reduce((a, b) => a + b, 0);  // 第 138 行
percentage: totalAllocated > 0 ? +((score / totalAllocated) * 100).toFixed(2) : 0,  // 第 143 行
```

### 4.2 边界场景分析

#### 场景一：所有分配额为零（totalAllocated = 0）

- 第 143 行：`totalAllocated > 0` 为 false，所有选项百分比 = 0
- 第 146 行：排序按 `score` 降序，所有 score = 0，排序结果取决于 `Object.entries` 的迭代顺序（即选项插入顺序）
- 第 148 行：`winner = sorted[0]?.option_id`，赢家为第一个插入的选项
- **问题**：当所有人弃权或所有分配额为 0 时，系统仍会选出一个"赢家"，这缺乏合理性。应返回 `winner: null` 或标记为无有效结果。

#### 场景二：分配额总和为负数

- 可能触发条件：用户提交负数分配值（服务端未校验），或用户权重为负数
- 第 143 行：`totalAllocated > 0` 为 false，所有百分比 = 0
- 但 `score` 字段仍为负数，且 `winner` 为负数中最大者
- **问题**：负数百分比被掩盖为 0，但 score 仍为负数，前端展示可能产生困惑（百分比为 0 但排名有先后）

#### 场景三：用户权重为零

**代码位置**：[server.js](file:///Users/huwenjie/项目/gsb/hwj-00489/server.js) 第 362–363 行

```javascript
const user = db.prepare('SELECT weight FROM users WHERE id = ?').get(vote.user_id);
return { ...vote, weight: user?.weight || 1 };
```

JavaScript 中 `0 || 1` 的求值结果为 `1`。当用户权重为 0 时，`user.weight` 为 `0`，`0 || 1` 返回 `1`，即权重为 0 的用户实际按权重 1 计票。

**影响**：无法通过设置权重为 0 来实现"剥夺投票权"的效果，这是一个功能性 bug。

#### 场景四：用户权重为负数

`-1 || 1` 在 JavaScript 中求值为 `-1`（因为 -1 是 truthy 值）。负权重会直接传入算法，导致：
- 该用户的投票对所选项产生负贡献
- 在加权分配中，`amount * (-1)` 会使选项得分减少
- 可能导致 `totalAllocated` 为零或负数

**影响**：恶意或误配置的负权重可以翻转其他人的投票结果。

#### 场景五：前端分配值校验可绕过

[public/js/app.js](file:///Users/huwenjie/项目/gsb/hwj-00489/public/js/app.js) 第 659–671 行，前端校验权重总和必须等于 100：

```javascript
if (total !== 100) {
  this.showToast('权重总和必须等于100分', 'error');
  return;
}
```

但此校验仅在客户端执行，服务端（[server.js](file:////huwenjie/项目/gsb/hwj-00489/server.js) 第 258–320 行 `POST /api/polls/:id/vote`）未对 `vote_data.allocations` 做任何校验。攻击者可直接发送 HTTP 请求提交：
- 负数分配值
- 总和不为 100 的分配
- 超出合理范围的值

### 4.3 改进建议

| 问题 | 建议 |
|------|------|
| totalAllocated = 0 时仍选出赢家 | 增加 `totalAllocated === 0` 判断，此时返回 `winner: null` 并标记 `no_valid_allocation: true` |
| totalAllocated < 0 时百分比被掩盖 | 增加 `totalAllocated < 0` 判断，此时不应计算百分比，应返回错误状态 |
| 权重为 0 被误转为 1 | 将 `user?.weight \|\| 1` 改为 `user?.weight !== undefined && user?.weight !== null ? user.weight : 1`，或使用 nullish coalescing `user?.weight ?? 1` |
| 负权重未拦截 | 在数据库层增加 `CHECK(weight >= 0)` 约束；在服务端校验权重非负 |
| 服务端未校验分配值 | 在 `POST /api/polls/:id/vote` 中增加校验逻辑：所有分配值 ≥ 0，总和 = 100（或允许的容差范围内） |
| 负数分配值 | 服务端校验 `Object.values(allocations).every(v => v >= 0)` |

---

## 附录：问题汇总与优先级

| # | 维度 | 问题 | 严重程度 | 修复优先级 |
|---|------|------|----------|------------|
| 1 | Condorcet | Smith 集算法在存在 Condorcet 赢家时可能返回错误结果 | 高 | P0 |
| 2 | 匿名泄露 | 导出接口无视匿名标志，创建者可导出完整个人投票 | 高 | P0 |
| 3 | 匿名泄露 | 热力图接口无视匿名标志，所有用户可见个人投票矩阵 | 高 | P0 |
| 4 | 加权分配 | 用户权重为 0 时被误转为 1 | 中 | P1 |
| 5 | 加权分配 | 服务端未校验分配值，可提交负数或非法总和 | 中 | P1 |
| 6 | Borda | 部分排名导致投票权重不均等 | 中 | P1 |
| 7 | Condorcet | 无 Condorcet 赢家时缺乏回退决策机制 | 中 | P2 |
| 8 | 匿名泄露 | 稳定性分析暴露关键投票者 user_id | 中 | P2 |
| 9 | 匿名泄露 | 投票详情接口在匿名模式下暴露已投票者名单 | 低 | P2 |
| 10 | Borda | 多轮淘汰后 ranking index 未重算 | 低 | P3 |
| 11 | Condorcet | 平票判定过严，偶数投票人时易无赢家 | 低 | P3 |
| 12 | 加权分配 | totalAllocated = 0 时仍选出赢家 | 低 | P3 |
