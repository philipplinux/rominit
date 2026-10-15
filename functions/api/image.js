// Serves a comment screenshot: GET /api/image?id=<comment id>. Always WebP, never sniffed or scripted.
/** @param {{request:Request, env:any}} context */
export async function onRequestGet({ request, env }) {
  const id = Number(new URL(request.url).searchParams.get('id'));
  const row = Number.isSafeInteger(id) ? await env.DB.prepare('SELECT data FROM comment_images WHERE comment_id = ?1').bind(id).first() : null;
  if (!row) return new Response('not found', { status: 404 });
  return new Response(new Uint8Array(row.data), { headers: { 'content-type': 'image/webp', 'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'", 'cache-control': 'public, max-age=86400' } });
}
