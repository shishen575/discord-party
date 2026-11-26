import unanimous from './unanimous.js';
import watch from './watch.js';

// 新しいゲームはここに追加するだけ (サーバー側 server/games/index.js にも同じIDで追加)
export const games = { [unanimous.id]: unanimous, [watch.id]: watch };
