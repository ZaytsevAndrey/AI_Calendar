import {
  deletePushSubscription,
  getVapidPublicKey,
  savePushSubscription,
} from 'api/reminders.api';
import i18n from 'i18n';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

function canUsePush(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function browserHasPushSubscription(): Promise<boolean> {
  if (!canUsePush()) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return !!subscription;
}

/** Ask for permission, subscribe this browser, and store it on the account. */
export async function enableBrowserReminders(): Promise<void> {
  if (!canUsePush()) {
    throw new Error(i18n.t('pwa.cannotShow'));
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(i18n.t('pwa.notificationsBlocked'));
  }
  const publicKey = await getVapidPublicKey();
  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) await existing.unsubscribe();
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error(i18n.t('pwa.subscriptionReadFailed'));
  }
  await savePushSubscription({
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  });
}

export async function disableBrowserReminders(): Promise<void> {
  if (!canUsePush()) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  try {
    await deletePushSubscription(subscription.endpoint);
  } finally {
    await subscription.unsubscribe();
  }
}
