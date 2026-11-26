import { esc, avatarHtml } from '../util.js';

// ctx: { g: ゲームのビュー, players: Map, me, isHost, send(action) }
export default {
  id: 'unanimous',

  render(el, ctx) {
    const { g, players, me, isHost, send } = ctx;
    const name = (id) => players.get(id)?.name ?? '(退出)';
    const chip = (id, extra = '') =>
      `<div class="chip ${extra}">${avatarHtml(players.get(id) ?? { name: '?' })}<span>${esc(name(id))}</span></div>`;

    let html = `<div class="scorebar">成功 <b>${g.score}</b> / ${g.history.length} 回</div>`;

    if (g.phase === 'topic') {
      html += isHost
        ? `<h2>お題を決めてください</h2>
           <form data-f="topic" class="row">
             <input id="topicInput" maxlength="80" placeholder="例: 夏といえば?" autocomplete="off" />
             <button class="btn primary">出題</button>
           </form>
           <p class="hint">自由に入力できます。出題すると全員が答え始めます。</p>`
        : `<h2>ホストがお題を考えています…</h2><div class="pulse">⏳</div>`;
    }

    if (g.phase === 'answer') {
      const joined = g.participants.filter((id) => players.get(id)?.connected);
      html += `<div class="topic">${esc(g.topic)}</div>`;
      if (g.participants.includes(me)) {
        html += g.myAnswer
          ? `<div class="mine">あなたの答え: <b>${esc(g.myAnswer)}</b> <button class="btn ghost" data-a="retract">取り消す</button></div>`
          : `<form data-f="answer" class="row">
               <input id="answerInput" maxlength="30" placeholder="答えを入力" autocomplete="off" />
               <button class="btn primary">決定</button>
             </form>`;
      } else {
        html += `<p class="hint">この回は観戦中です</p>`;
      }
      html += `<div class="chips">${joined
        .map((id) => chip(id, g.submitted.includes(id) ? 'done' : 'wait'))
        .join('')}</div>
        <p class="hint">${g.submitted.length} / ${g.participants.length} 人が回答済み(回答内容は公開までわかりません)</p>`;
      if (isHost) html += `<button class="btn ghost" data-a="forceReveal" ${g.submitted.length ? '' : 'disabled'}>今すぐ公開</button>`;
    }

    if (g.phase === 'reveal') {
      html += `<div class="topic">${esc(g.topic)}</div><div class="answers">${g.participants
        .map(
          (id) =>
            `<div class="ans">${avatarHtml(players.get(id) ?? { name: '?' })}<span class="who">${esc(name(id))}</span><span class="what">${
              g.answers[id] ? esc(g.answers[id]) : '<i>未回答</i>'
            }</span></div>`,
        )
        .join('')}</div>`;
      if (g.judged === null) {
        if (isHost) {
          html += `<p class="hint">${g.autoMatch ? '💡 表記ゆれを考慮すると全員一致しているようです' : '全員一致ではなさそうです'}。判定してください。</p>
            <div class="row"><button class="btn ok" data-a="judge" data-v="1">⭕ 全会一致!</button><button class="btn ng" data-a="judge" data-v="0">❌ 不一致</button></div>`;
        } else {
          html += `<div class="pulse">ホストが判定中…</div>`;
        }
      } else {
        html += `<div class="result ${g.judged ? 'ok' : 'ng'}">${g.judged ? '🎉 全会一致!' : '😢 残念…'}</div>`;
        if (isHost) html += `<div class="row"><button class="btn primary" data-a="next">次のお題へ</button><button class="btn ghost" data-a="end">ゲーム終了</button></div>`;
      }
    }

    if (g.phase === 'end') {
      html += `<h2>ゲーム終了</h2><div class="result ${g.score ? 'ok' : 'ng'}">${g.history.length}回中 ${g.score}回 成功</div>
        <ul class="history">${g.history
          .map((h) => `<li class="${h.success ? 'ok' : 'ng'}">${h.success ? '⭕' : '❌'} ${esc(h.topic)}</li>`)
          .join('')}</ul>`;
    }

    el.innerHTML = html;

    el.querySelector('[data-f="topic"]')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = el.querySelector('#topicInput').value.trim();
      if (v) send({ type: 'setTopic', topic: v });
    });
    el.querySelector('[data-f="answer"]')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = el.querySelector('#answerInput').value.trim();
      if (v) send({ type: 'submit', text: v });
    });
    el.querySelectorAll('[data-a]').forEach((b) =>
      b.addEventListener('click', () => {
        const a = b.dataset.a;
        send(a === 'judge' ? { type: 'judge', success: b.dataset.v === '1' } : { type: a });
      }),
    );
  },
};
