// The broadcaster (broadcaster/, Python) is the one trusted writer of show
// state, system chat messages, and coordinator calls. It authenticates with
// a shared secret; without one configured, those endpoints are closed.

export function isBroadcaster(request: Request): boolean {
  const secret = process.env.BROADCASTER_SECRET;
  if (!secret) return false;
  return request.headers.get("x-broadcaster-secret") === secret;
}
