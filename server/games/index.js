import unanimous from './unanimous.js';

// 新しいゲームはここに追加するだけ
export const games = { [unanimous.id]: unanimous };
export const gameList = () =>
  Object.values(games).map(({ id, name, description, minPlayers, maxPlayers }) => ({
    id, name, description, minPlayers, maxPlayers,
  }));
