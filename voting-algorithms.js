function calculatePlurality(votes, options) {
  const results = {};
  options.forEach(opt => { results[opt.id] = 0; });

  votes.forEach(vote => {
    if (vote.is_abstain) return;
    const voteData = JSON.parse(vote.vote_data);
    if (voteData.option_id && results.hasOwnProperty(voteData.option_id)) {
      results[voteData.option_id] += vote.weight || 1;
    }
  });

  const sorted = Object.entries(results)
    .map(([id, score]) => ({ option_id: parseInt(id), score, text: options.find(o => o.id === parseInt(id))?.text }))
    .sort((a, b) => b.score - a.score);

  return {
    type: 'plurality',
    results: sorted,
    winner: sorted[0]?.option_id,
    totalVotes: votes.filter(v => !v.is_abstain).length
  };
}

function calculateApproval(votes, options) {
  const results = {};
  options.forEach(opt => { results[opt.id] = 0; });

  votes.forEach(vote => {
    if (vote.is_abstain) return;
    const voteData = JSON.parse(vote.vote_data);
    if (Array.isArray(voteData.option_ids)) {
      voteData.option_ids.forEach(optId => {
        if (results.hasOwnProperty(optId)) {
          results[optId] += vote.weight || 1;
        }
      });
    }
  });

  const sorted = Object.entries(results)
    .map(([id, score]) => ({ option_id: parseInt(id), score, text: options.find(o => o.id === parseInt(id))?.text }))
    .sort((a, b) => b.score - a.score);

  return {
    type: 'approval',
    results: sorted,
    winner: sorted[0]?.option_id,
    totalVotes: votes.filter(v => !v.is_abstain).length
  };
}

function calculateBorda(votes, options) {
  const n = options.length;
  const results = {};
  options.forEach(opt => { results[opt.id] = 0; });

  votes.forEach(vote => {
    if (vote.is_abstain) return;
    const voteData = JSON.parse(vote.vote_data);
    if (Array.isArray(voteData.ranking)) {
      voteData.ranking.forEach((optId, index) => {
        if (results.hasOwnProperty(optId)) {
          const points = (n - 1 - index) * (vote.weight || 1);
          results[optId] += points;
        }
      });
    }
  });

  const sorted = Object.entries(results)
    .map(([id, score]) => ({ option_id: parseInt(id), score, text: options.find(o => o.id === parseInt(id))?.text }))
    .sort((a, b) => b.score - a.score);

  return {
    type: 'borda',
    results: sorted,
    winner: sorted[0]?.option_id,
    totalVotes: votes.filter(v => !v.is_abstain).length
  };
}

function calculateScore(votes, options) {
  const totals = {};
  const counts = {};
  options.forEach(opt => {
    totals[opt.id] = 0;
    counts[opt.id] = 0;
  });

  votes.forEach(vote => {
    if (vote.is_abstain) return;
    const voteData = JSON.parse(vote.vote_data);
    if (voteData.scores) {
      Object.entries(voteData.scores).forEach(([optId, score]) => {
        const id = parseInt(optId);
        if (totals.hasOwnProperty(id)) {
          totals[id] += score * (vote.weight || 1);
          counts[id] += vote.weight || 1;
        }
      });
    }
  });

  const results = options.map(opt => ({
    option_id: opt.id,
    score: counts[opt.id] > 0 ? +(totals[opt.id] / counts[opt.id]).toFixed(2) : 0,
    total_score: totals[opt.id],
    voter_count: counts[opt.id],
    text: opt.text
  })).sort((a, b) => b.score - a.score);

  return {
    type: 'score',
    results,
    winner: results[0]?.option_id,
    totalVotes: votes.filter(v => !v.is_abstain).length
  };
}

function calculateWeightedAllocation(votes, options) {
  const results = {};
  options.forEach(opt => { results[opt.id] = 0; });

  votes.forEach(vote => {
    if (vote.is_abstain) return;
    const voteData = JSON.parse(vote.vote_data);
    if (voteData.allocations) {
      Object.entries(voteData.allocations).forEach(([optId, amount]) => {
        const id = parseInt(optId);
        if (results.hasOwnProperty(id)) {
          results[id] += amount * (vote.weight || 1);
        }
      });
    }
  });

  const totalAllocated = Object.values(results).reduce((a, b) => a + b, 0);
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
    winner: sorted[0]?.option_id,
    totalVotes: votes.filter(v => !v.is_abstain).length,
    totalAllocated: +totalAllocated.toFixed(2)
  };
}

function calculateResults(pollType, votes, options) {
  const activeOptions = options.filter(o => !o.eliminated);
  
  switch (pollType) {
    case 'single':
      return calculatePlurality(votes, activeOptions);
    case 'multiple':
      return calculateApproval(votes, activeOptions);
    case 'ranked':
      return calculateBorda(votes, activeOptions);
    case 'score':
      return calculateScore(votes, activeOptions);
    case 'weighted':
      return calculateWeightedAllocation(votes, activeOptions);
    default:
      return { type: pollType, results: [], winner: null, totalVotes: 0 };
  }
}

function findCondorcetWinner(votes, options) {
  const optionIds = options.map(o => o.id);
  const pairWins = {};
  
  optionIds.forEach(a => {
    pairWins[a] = {};
    optionIds.forEach(b => {
      if (a !== b) pairWins[a][b] = 0;
    });
  });

  votes.forEach(vote => {
    if (vote.is_abstain) return;
    const voteData = JSON.parse(vote.vote_data);
    const ranking = voteData.ranking || [];
    
    for (let i = 0; i < ranking.length; i++) {
      for (let j = i + 1; j < ranking.length; j++) {
        const a = ranking[i];
        const b = ranking[j];
        if (pairWins[a] && pairWins[a][b] !== undefined) {
          pairWins[a][b] += vote.weight || 1;
        }
      }
    }

    if (voteData.option_id) {
      optionIds.forEach(b => {
        if (b !== voteData.option_id) {
          pairWins[voteData.option_id][b] += vote.weight || 1;
        }
      });
    }
  });

  let condorcetWinner = null;
  for (const a of optionIds) {
    let beatsAll = true;
    for (const b of optionIds) {
      if (a === b) continue;
      const aVotes = pairWins[a][b] || 0;
      const bVotes = pairWins[b][a] || 0;
      if (aVotes <= bVotes) {
        beatsAll = false;
        break;
      }
    }
    if (beatsAll) {
      condorcetWinner = a;
      break;
    }
  }

  const pairwiseMatrix = {};
  optionIds.forEach(a => {
    pairwiseMatrix[a] = {};
    optionIds.forEach(b => {
      pairwiseMatrix[a][b] = pairWins[a][b] || 0;
    });
  });

  return {
    hasWinner: condorcetWinner !== null,
    winner: condorcetWinner,
    winnerText: condorcetWinner ? options.find(o => o.id === condorcetWinner)?.text : null,
    pairwiseMatrix
  };
}

function findSmithSet(votes, options) {
  const optionIds = options.map(o => o.id);
  const condorcet = findCondorcetWinner(votes, options);
  const matrix = condorcet.pairwiseMatrix;

  const beats = (a, b) => (matrix[a][b] || 0) > (matrix[b][a] || 0);

  let smithSet = [...optionIds];
  let changed = true;

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

  return {
    smithSet,
    smithSetTexts: smithSet.map(id => options.find(o => o.id === id)?.text),
    size: smithSet.length
  };
}

function analyzeStability(votes, options, pollType) {
  const baseResults = calculateResults(pollType, votes, options);
  const baseWinner = baseResults.winner;
  
  const analyses = [];
  let canChange = false;

  votes.forEach((vote, voterIndex) => {
    if (vote.is_abstain) return;
    
    const modifiedVotes = votes.filter((_, i) => i !== voterIndex);
    const modifiedResults = calculateResults(pollType, modifiedVotes, options);
    
    const resultChanges = modifiedResults.winner !== baseWinner;
    if (resultChanges) canChange = true;

    analyses.push({
      voter_id: vote.user_id,
      original_winner: baseWinner,
      modified_winner: modifiedResults.winner,
      changes_result: resultChanges,
      pivotal: resultChanges
    });
  });

  const pivotalVoters = analyses.filter(a => a.pivotal).map(a => a.voter_id);

  return {
    stable: !canChange,
    canChange,
    pivotalVoterCount: pivotalVoters.length,
    pivotalVoters,
    totalVoters: votes.filter(v => !v.is_abstain).length
  };
}

function checkSupermajority(results, totalVotes, threshold = 2/3) {
  if (results.length === 0) return { passed: false, threshold: threshold };
  
  const winner = results[0];
  const yesVotes = winner.score;
  const required = Math.ceil(totalVotes * threshold);
  
  return {
    passed: yesVotes >= required,
    threshold: threshold,
    yesVotes,
    required,
    totalVotes,
    percentage: totalVotes > 0 ? +((yesVotes / totalVotes) * 100).toFixed(2) : 0
  };
}

function analyzeTrend(pollResultsList) {
  if (!pollResultsList || pollResultsList.length < 2) {
    return { error: '至少需要2个投票结果才能进行趋势分析', trends: [] };
  }

  const optionScores = {};
  const pollTimestamps = [];

  pollResultsList.forEach((pr, idx) => {
    pollTimestamps.push(pr.timestamp || idx);
    pr.results.forEach(r => {
      if (!optionScores[r.text]) {
        optionScores[r.text] = [];
      }
      while (optionScores[r.text].length < idx) {
        optionScores[r.text].push(null);
      }
      optionScores[r.text].push(r.score);
    });
  });

  const trends = Object.entries(optionScores).map(([optionText, scores]) => {
    const validScores = scores.filter(s => s !== null);
    if (validScores.length < 2) {
      return { option: optionText, scores, trend: 'insufficient_data', change: 0 };
    }

    const first = validScores[0];
    const last = validScores[validScores.length - 1];
    const change = last - first;
    const avg = validScores.reduce((a, b) => a + b, 0) / validScores.length;

    let trend = 'stable';
    if (change > 0.1 * avg) trend = 'rising';
    else if (change < -0.1 * avg) trend = 'falling';

    return {
      option: optionText,
      scores,
      trend,
      change: +change.toFixed(2),
      changePercent: first > 0 ? +((change / first) * 100).toFixed(2) : 0,
      average: +avg.toFixed(2),
      max: Math.max(...validScores),
      min: Math.min(...validScores)
    };
  });

  return {
    pollCount: pollResultsList.length,
    timestamps: pollTimestamps,
    trends
  };
}

function calculateScoreMatrix(poll, votes, options, users) {
  const matrix = [];
  const optionLabels = options.map(o => o.text);
  const userLabels = [];

  users.forEach(user => {
    const userVote = votes.find(v => v.user_id === user.id);
    if (!userVote) return;

    userLabels.push(user.display_name || user.username);
    const row = [];

    if (userVote.is_abstain) {
      options.forEach(() => row.push(null));
    } else {
      const voteData = JSON.parse(userVote.vote_data);
      options.forEach(opt => {
        if (poll.type === 'single') {
          row.push(voteData.option_id === opt.id ? 1 : 0);
        } else if (poll.type === 'multiple') {
          row.push((voteData.option_ids || []).includes(opt.id) ? 1 : 0);
        } else if (poll.type === 'ranked') {
          const rankIdx = (voteData.ranking || []).indexOf(opt.id);
          row.push(rankIdx >= 0 ? options.length - rankIdx : 0);
        } else if (poll.type === 'score') {
          row.push(voteData.scores ? (voteData.scores[opt.id] || 0) : null);
        } else if (poll.type === 'weighted') {
          row.push(voteData.allocations ? (voteData.allocations[opt.id] || 0) : null);
        } else {
          row.push(null);
        }
      });
    }
    matrix.push(row);
  });

  return { matrix, optionLabels, userLabels };
}

function calculateSankeyFlow(multiRoundVotes, options) {
  if (multiRoundVotes.length < 2) {
    return { error: '至少需要2轮投票数据', nodes: [], links: [] };
  }

  const nodes = [];
  const optionMap = {};

  options.forEach((opt, idx) => {
    const nodeId = `opt_${idx}`;
    optionMap[opt.id] = { id: nodeId, name: opt.text, index: idx };
    nodes.push({ id: nodeId, name: opt.text, round: 0 });
  });

  const roundCount = multiRoundVotes.length;
  for (let r = 1; r < roundCount; r++) {
    options.forEach((opt, idx) => {
      nodes.push({ id: `opt_${idx}_r${r}`, name: opt.text, round: r });
    });
  }

  const links = [];
  for (let r = 0; r < roundCount - 1; r++) {
    const roundVotes = multiRoundVotes[r];
    const nextRoundVotes = multiRoundVotes[r + 1];

    const flowMap = {};

    roundVotes.forEach(vote => {
      if (vote.is_abstain) return;
      const prevData = JSON.parse(vote.vote_data);
      const nextVote = nextRoundVotes.find(nv => nv.user_id === vote.user_id);
      if (!nextVote || nextVote.is_abstain) return;
      const nextData = JSON.parse(nextVote.vote_data);

      let prevOpt = null;
      if (prevData.option_id) prevOpt = prevData.option_id;
      else if (prevData.ranking && prevData.ranking.length > 0) prevOpt = prevData.ranking[0];
      else if (prevData.option_ids && prevData.option_ids.length > 0) prevOpt = prevData.option_ids[0];

      let nextOpt = null;
      if (nextData.option_id) nextOpt = nextData.option_id;
      else if (nextData.ranking && nextData.ranking.length > 0) nextOpt = nextData.ranking[0];
      else if (nextData.option_ids && nextData.option_ids.length > 0) nextOpt = nextData.option_ids[0];

      if (prevOpt && nextOpt && optionMap[prevOpt] && optionMap[nextOpt]) {
        const key = `${prevOpt}_${nextOpt}`;
        flowMap[key] = (flowMap[key] || 0) + (vote.weight || 1);
      }
    });

    Object.entries(flowMap).forEach(([key, value]) => {
      const [prevId, nextId] = key.split('_').map(Number);
      const prevInfo = optionMap[prevId];
      const nextInfo = optionMap[nextId];
      if (prevInfo && nextInfo) {
        links.push({
          source: r === 0 ? prevInfo.id : `opt_${prevInfo.index}_r${r}`,
          target: `opt_${nextInfo.index}_r${r + 1}`,
          value
        });
      }
    });
  }

  return { nodes, links, roundCount };
}

module.exports = {
  calculateResults,
  calculatePlurality,
  calculateApproval,
  calculateBorda,
  calculateScore,
  calculateWeightedAllocation,
  findCondorcetWinner,
  findSmithSet,
  analyzeStability,
  checkSupermajority,
  analyzeTrend,
  calculateScoreMatrix,
  calculateSankeyFlow
};
