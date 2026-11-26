// 全会一致ゲーム: 主催者(ホスト)がお題を自由に決め、全員が答え、一致したかをホストが判定する。
// phase: topic(ホストがお題入力) → answer(全員回答) → reveal(公開・ホスト判定) → topic ... / end

// 表記ゆれを吸収した「自動判定の目安」。最終判断はホストが行う。
export function normalize(text) {
  return String(text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s　、。,.!?!?ー~〜・]/g, '');
}

const connectedIds = (room) => [...room.players.values()].filter((p) => p.connected).map((p) => p.id);

export default {
  id: 'unanimous',
  name: '全会一致ゲーム',
  description: 'ホストがお題を出し、全員が同じ答えなら成功!一致の判定もホストが決めます。',
  minPlayers: 2,
  maxPlayers: 20,

  init(room) {
    return {
      participants: connectedIds(room),
      phase: 'topic',
      topic: null,
      answers: {},
      judged: null, // null=未判定 / true=成功 / false=失敗
      history: [], // {topic, answers, success}
    };
  },

  onAction(room, s, pid, a) {
    const isHost = pid === room.hostId;
    switch (a.type) {
      case 'setTopic': {
        if (!isHost || s.phase !== 'topic') return;
        const topic = String(a.topic ?? '').trim().slice(0, 80);
        if (!topic) return;
        s.topic = topic;
        s.participants = connectedIds(room); // この回の参加者を確定
        s.answers = {};
        s.judged = null;
        s.phase = 'answer';
        return;
      }
      case 'submit': {
        if (s.phase !== 'answer' || !s.participants.includes(pid)) return;
        const text = String(a.text ?? '').trim().slice(0, 30);
        if (!text) return;
        s.answers[pid] = text;
        this.checkAllSubmitted(room, s);
        return;
      }
      case 'retract':
        if (s.phase === 'answer') delete s.answers[pid];
        return;
      case 'forceReveal':
        if (isHost && s.phase === 'answer' && Object.keys(s.answers).length > 0) s.phase = 'reveal';
        return;
      case 'judge':
        if (!isHost || s.phase !== 'reveal' || s.judged !== null) return;
        s.judged = !!a.success;
        s.history.push({ topic: s.topic, answers: { ...s.answers }, success: s.judged, participants: s.participants });
        return;
      case 'next':
        if (isHost && s.phase === 'reveal' && s.judged !== null) {
          s.phase = 'topic';
          s.topic = null;
          s.answers = {};
          s.judged = null;
        }
        return;
      case 'end':
        if (isHost && s.phase !== 'end') {
          // 判定せずに終了した場合、公開済みの回は記録しない
          s.phase = 'end';
        }
        return;
    }
  },

  checkAllSubmitted(room, s) {
    const active = s.participants.filter((id) => room.players.get(id)?.connected);
    if (active.length > 0 && active.every((id) => s.answers[id])) s.phase = 'reveal';
  },

  onPlayerChange(room, s) {
    if (s.phase === 'answer') this.checkAllSubmitted(room, s);
  },

  view(room, s, pid) {
    const revealed = s.phase === 'reveal' || s.phase === 'end';
    const vals = s.participants.map((id) => s.answers[id]).filter(Boolean);
    const autoMatch =
      revealed && vals.length === s.participants.length && new Set(vals.map(normalize)).size === 1;
    return {
      participants: s.participants,
      phase: s.phase,
      topic: s.topic,
      submitted: Object.keys(s.answers),
      myAnswer: s.answers[pid] ?? null,
      answers: s.phase === 'reveal' ? s.answers : undefined,
      judged: s.judged,
      autoMatch, // ホスト判定の参考ヒント
      history: s.history,
      score: s.history.filter((h) => h.success).length,
    };
  },
};
