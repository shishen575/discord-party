export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const avatarHtml = (p) =>
  p.avatar
    ? `<img class="avatar" src="${esc(p.avatar)}" alt="" />`
    : `<span class="avatar ph">${esc([...p.name][0] ?? '?')}</span>`;
