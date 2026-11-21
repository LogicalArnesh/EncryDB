import { connect } from 'cloudflare:sockets'
import { createApp } from './app'
import type { ConnectFn } from './smtp'
import { getAuth, type Env } from './auth'

// The mailer receives connect() rather than importing it, so the SMTP client
// stays testable outside the Workers runtime. workers-types marks the socket
// streams nullable; sendSmtpMail only touches them after `opened` resolves.
const app = createApp(undefined, connect as unknown as ConnectFn)

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    try {
      const handler = (req: Request) =>
        Promise.resolve(app.fetch(req, env, ctx))
      const auth = getAuth(env)
      // Freebuff sign-in routes and refreshed cookies run before assets.
      return await (auth ? auth.wrap(handler)(request) : handler(request))
    } catch (error) {
      console.error('worker error', error)
      return Response.json(
        { error: 'Something went wrong. Please try again.' },
        { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
      )
    }
  },
}
