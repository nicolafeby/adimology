export const SESSION_EXPIRED_EVENT = 'adimology:session-expired';

/** Ask the application gate to renew a guest session or show the password form. */
export function notifySessionExpired() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}
