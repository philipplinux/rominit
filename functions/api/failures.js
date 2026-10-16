// Debug logs of flash stages that stopped, sent by the flasher on its own. They land in the admin inbox
// ("Flash failures"; `npm run inbox -- failures` from the CLI) so recipes can be fixed.
import { json, knownRom, voterOf } from '../_lib/api.js';

/** One log per address per minute, 30 a day. @param {{request:Request, env:any}} context */
export async function onRequestPost({ request, env }) {
  if (!env.SALT) return json({ error: 'not configured' }, 503);
  const { rom, stage, error, log } = await request.json().catch(() => ({}));
  if (!Number.isInteger(stage) || stage < 1 || stage > 20 || typeof error !== 'string' || !error || error.length > 2000
    || typeof log !== 'string' || !log || log.length > 200_000 || !await knownRom(env, request, rom)) return json({ error: 'bad failure log' }, 400);
  const voter = await voterOf(env, request);
  const seen = await env.DB.prepare("SELECT COUNT(*) AS day, SUM(at > datetime('now', '-1 minute')) AS minute FROM flash_failures WHERE voter = ?1 AND at > datetime('now', '-1 day')").bind(voter).first();
  if (seen?.minute || seen?.day >= 30) return json({ error: 'too many failure logs' }, 429);
  await env.DB.prepare('INSERT INTO flash_failures (rom, stage, error, log, voter) VALUES (?1, ?2, ?3, ?4, ?5)').bind(rom, stage, error, log, voter).run();
  return json({ ok: true });
}
