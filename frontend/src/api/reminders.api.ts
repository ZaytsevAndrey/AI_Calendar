import apiCall from 'modules/common/utils/apiCall';

export async function getVapidPublicKey(): Promise<string> {
  const response = await apiCall({ method: 'GET', url: '/reminders/vapid-public-key' });
  const data = response?.data as { publicKey?: string } | undefined;
  const key = data?.publicKey;
  if (typeof key !== 'string' || !key) {
    throw new Error('Web Push is not configured');
  }
  return key;
}

export async function savePushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
}): Promise<void> {
  await apiCall({ method: 'POST', url: '/reminders/subscriptions', data: input });
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  await apiCall({ method: 'DELETE', url: '/reminders/subscriptions', data: { endpoint } });
}
