import { db } from './store.ts';

export interface WebhookEventData {
  eventType: 'DONOR_CONTACT_REQUEST' | 'DONOR_RESPONSE' | 'NEW_BLOOD_REQUEST' | 'APPOINTMENT_SCHEDULED' | 'USER_REGISTRATION';
  recipientEmail: string;
  recipientName: string;
  subject: string;
  payload: Record<string, any>;
}

/**
 * Dispatches an event directly to the configured n8n Webhook URL.
 * Automatically logs request & response into LifeLink Automation Outbox/Delivery Logs.
 */
export async function triggerN8nWebhook(eventData: WebhookEventData): Promise<{
  dispatched: boolean;
  status?: number;
  message?: string;
}> {
  const webhookUrl = db.settings.N8N_WEBHOOK_URL || process.env.N8N_WEBHOOK_URL || '';
  const isEnabled = db.settings.AUTOMATION_ENABLED === 'true';

  if (!isEnabled || !webhookUrl || !webhookUrl.startsWith('http')) {
    return { dispatched: false, message: 'Automation disabled or webhook URL not configured' };
  }

  // Detect localhost when server is running in the cloud
  if (webhookUrl.includes('localhost') || webhookUrl.includes('127.0.0.1')) {
    const localhostMsg = 'Localhost Detected: LifeLink is running on Cloud Run, while localhost:5678 is on your personal laptop.';
    return { dispatched: false, message: localhostMsg };
  }

  try {
    const idempotencyKey = 'auto-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);

    const bodyData = {
      event: eventData.eventType,
      eventType: eventData.eventType,
      timestamp: new Date().toISOString(),
      recipientEmail: eventData.recipientEmail,
      recipientName: eventData.recipientName,
      subject: eventData.subject,
      payload: eventData.payload,
      idempotencyKey,
      source: 'LifeLink Sri Lanka Blood Donation System'
    };

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-lifelink-secret': db.settings.N8N_WEBHOOK_SECRET || 'lifelink-secret-key-jaffna',
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(bodyData)
    });

    const responseText = await res.text();

    db.deliveryLogs.unshift({
      id: 'del-' + Math.random().toString(36).substring(2, 9),
      outboxId: idempotencyKey,
      eventType: eventData.eventType,
      webhookUrl,
      requestPayload: JSON.stringify(eventData.payload),
      responseStatus: res.status,
      responseBody: responseText.slice(0, 500),
      deliveredAt: new Date().toISOString()
    });

    return {
      dispatched: res.ok,
      status: res.status,
      message: res.ok ? 'Delivered successfully to n8n' : `n8n returned HTTP ${res.status}`
    };
  } catch (err: any) {
    db.deliveryLogs.unshift({
      id: 'del-' + Math.random().toString(36).substring(2, 9),
      outboxId: 'err-' + Date.now(),
      eventType: eventData.eventType,
      webhookUrl,
      requestPayload: JSON.stringify(eventData.payload),
      responseStatus: 0,
      responseBody: '',
      deliveredAt: new Date().toISOString(),
      error: err.message
    });
    return { dispatched: false, message: err.message };
  }
}
