import unanimous from './unanimous.js';
import watch from './watch.js';

// 新しいゲームはここに追加するだけ
export const games = { [unanimous.id]: unanimous, [watch.id]: watch };
export const gameList = () =>
  Object.values(games).map(({ id, name, description, minPlayers, maxPlayers }) => ({
    id, name, description, minPlayers, maxPlayers,
  }));
