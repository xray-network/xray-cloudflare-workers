/**
 * @@ XRAY | Graph
 * Cloudflare IPFS (or Registry) to Images CDN
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return new Response("Hello World!")
  },
}
