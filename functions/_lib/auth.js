// Accounts: Google / GitHub OAuth, a session cookie, and roles scoped to parts of the catalog.
// Secrets (wrangler pages secret put …): GOOGLE_CLIENT_ID/SECRET, GITHUB_CLIENT_ID/SECRET; ADMINS = comma-separated emails.
// Grant a role (role: owner | moderator; scope: * | os:<os> | vendor:<vendor> | device:<codename> | rom:<codename>/<rom id>):
//   npx wrangler d1 execute rominit --remote --command "INSERT INTO roles (user_id, role, scope) VALUES (<user id>, 'owner', 'os:postmarketOS')"
//   (user ids: SELECT id, provider, name, email FROM users)

/** OAuth endpoints per provider; a provider shows up once its client id and secret are set. */
export const PROVIDERS = {
  google: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope: 'openid email profile' },
  github: { authorize: 'https://github.com/login/oauth/authorize', token: 'https://github.com/login/oauth/access_token', scope: 'read:user user:email' },
};
/** @param {any} env @param {string} name */
export const configured = (env, name) => name in PROVIDERS && !!env[`${name.toUpperCase()}_CLIENT_ID`] && !!env[`${name.toUpperCase()}_CLIENT_SECRET`];

/** @param {string} text */
export async function sha256hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const randomToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' })[c] ?? '');

/** @param {Request} request @param {string} name */
export const cookie = (request, name) => (request.headers.get('cookie') ?? '').split(/;\s*/).find(c => c.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';
/** Set-Cookie value; Secure on https (local wrangler runs on http). @param {Request} request @param {string} name @param {string} value @param {number} maxAge @param {string} path */
export const setCookie = (request, name, value, maxAge, path = '/') =>
  `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;

/** Only same-site paths, never `//evil` or a full URL. @param {unknown} path */
export const safeReturn = path => typeof path === 'string' && /^\/(?![/\\])/.test(path) ? path : '/';

/** The signed-in user, or null. @param {any} env @param {Request} request */
export async function userOf(env, request) {
  const token = cookie(request, 'sid');
  if (!token) return null;
  const user = await env.DB.prepare("SELECT u.id, u.provider, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?1 AND s.expires > datetime('now')")
    .bind(await sha256hex(token)).first();
  if (!user) return null;
  const { results } = await env.DB.prepare('SELECT role, scope FROM roles WHERE user_id = ?1').bind(user.id).all();
  const admins = (env.ADMINS ?? '').split(',').map((/** @type {string} */ e) => e.trim().toLowerCase()).filter(Boolean);
  if (user.email && admins.includes(user.email.toLowerCase())) results.push({ role: 'admin', scope: '*' });
  return { ...user, roles: /** @type {{role:string, scope:string}[]} */ (results) };
}

/** Catalog facts about one ROM, or null if unknown. @param {any} env @param {Request} request @param {unknown} rom `<codename>/<rom id>` */
export async function romInfo(env, request, rom) {
  if (typeof rom !== 'string') return null;
  const index = await (await env.ASSETS.fetch(new URL('/catalog/index.json', request.url))).json();
  for (const d of index) for (const r of d.roms) if (`${d.codename}/${r.id}` === rom) return { key: rom, codename: d.codename, vendor: d.vendor, os: r.os, version: r.version };
  return null;
}

/** Does a role scope cover this ROM? @param {string} scope @param {{key:string, codename:string, vendor:string, os:string}} rom */
export const covers = (scope, rom) => scope === '*' || [`os:${rom.os}`, `vendor:${rom.vendor}`, `device:${rom.codename}`, `rom:${rom.key}`].includes(scope);
/** Strongest role a user holds over this ROM: admin > owner > moderator, or null. @param {{role:string, scope:string}[]} roles @param {any} rom */
export const roleOver = (roles, rom) => ['admin', 'owner', 'moderator'].find(role => roles.some(r => r.role === role && covers(r.scope, rom))) ?? null;
