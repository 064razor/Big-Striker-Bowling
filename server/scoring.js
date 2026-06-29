function scoreFromRolls(rolls) {
  let score = 0;
  let index = 0;
  for (let frame = 1; frame <= 10; frame++) {
    if (!Array.isArray(rolls) || rolls[index] === undefined) break;
    if (rolls[index] === 10) {
      if (rolls[index + 1] === undefined || rolls[index + 2] === undefined) break;
      score += 10 + rolls[index + 1] + rolls[index + 2];
      index++;
    } else {
      const first = rolls[index];
      const second = rolls[index + 1];
      if (second === undefined) break;
      if (first + second === 10) {
        if (rolls[index + 2] === undefined) break;
        score += 10 + rolls[index + 2];
      } else {
        score += first + second;
      }
      index += 2;
    }
  }
  return score;
}

function countGameWinner(room, statePlayers) {
  if (!room || room.finalWinCounted || !Array.isArray(statePlayers) || statePlayers.length === 0) return;
  const results = statePlayers
    .map((player, index) => ({ index, score: scoreFromRolls(player && player.rolls) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  if (!results.length) return;
  const winnerIndex = results[0].index;
  if (!Array.isArray(room.winCounts)) room.winCounts = [];
  while (room.winCounts.length < room.players.length) room.winCounts.push(0);
  room.winCounts[winnerIndex] = (room.winCounts[winnerIndex] || 0) + 1;
  room.finalWinCounted = true;
}

module.exports = { scoreFromRolls, countGameWinner };
