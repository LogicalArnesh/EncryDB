import { createApp } from './app'
import { getAuth, type Env } from './auth'

const app = createApp()

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
