// Telling the user a long task is over (an assistant turn, and any other):
// a notification of the system when the editor is in the background and the
// browser allows it, a message in the editor otherwise.

import { toast } from './state.ts';

const supported = () => typeof Notification !== 'undefined';

/** the browser's answer for the notifications: asked only when it was never given (from a click) */
export async function allowNotifications(): Promise<NotificationPermission | 'unsupported'> {
  if (!supported()) return 'unsupported';
  return Notification.permission === 'default' ? Notification.requestPermission() : Notification.permission;
}

/** what the browser says now, without asking */
export const notificationState = (): NotificationPermission | 'unsupported' => (supported() ? Notification.permission : 'unsupported');

/** the user is elsewhere: another tab, another window */
export const away = () => document.hidden || !document.hasFocus();

export function notify(title: string, body: string, kind: 'info' | 'error' = 'info') {
  if (away() && notificationState() === 'granted') {
    // one at a time: a new one replaces the previous (same tag)
    const n = new Notification(title, { body, tag: 'tramme' });
    n.onclick = () => { focus(); n.close(); };
    return;
  }
  toast(body, kind, 6000);
}
