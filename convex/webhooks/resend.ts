import { Resend } from 'resend';
import { api } from '../_generated/api';
import { httpAction } from '../_generated/server';

interface ResendEmailReceivedEvent {
  type: 'email.received';
  created_at: string;
  data: {
    email_id: string;
    created_at: string;
    from: string;
    to: string[];
    cc: string[];
    bcc: string[];
    message_id: string;
    subject: string;
    attachments?: Array<{
      id: string;
      filename: string;
      content_type: string;
      content_disposition: string;
      content_id?: string;
    }>;
  };
}

/**
 * Forward email to your inbox
 */
async function forwardEmail(event: ResendEmailReceivedEvent): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY || '');

  try {
    // Forward the email to yourself
    const forwardToEmail = process.env.FORWARD_TO_EMAIL;

    if (!forwardToEmail) {
      throw new Error('FORWARD_TO_EMAIL environment variable not set');
    }

    // Fetch the full email content from Resend
    const emailContent = await resend.emails.get(event.data.email_id);

    if (!emailContent) {
      throw new Error('Failed to fetch email content');
    }

    // Note: Attachments are not forwarded in this basic implementation
    // To add attachment forwarding, you'll need to implement the attachments API
    // as shown in the Resend documentation

    await resend.emails.send({
      from: process.env.RESEND_EMAIL_SENDER || 'onboarding@resend.dev',
      to: forwardToEmail,
      subject: `Fwd: ${event.data.subject}`,
      html: `
        <div style="border-left: 4px solid #ccc; padding-left: 15px; margin: 20px 0;">
          <p><strong>Originally From:</strong> ${event.data.from}</p>
          <p><strong>Originally To:</strong> ${event.data.to.join(', ')}</p>
          <p><strong>Original Subject:</strong> ${event.data.subject}</p>
          <p><strong>Received:</strong> ${new Date(event.data.created_at).toLocaleString()}</p>
        </div>
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
        ${emailContent.data?.html || emailContent.data?.text || 'No content available'}
      `,
      text: `
-------- Forwarded Message --------
Originally From: ${event.data.from}
Originally To: ${event.data.to.join(', ')}
Original Subject: ${event.data.subject}
Received: ${new Date(event.data.created_at).toLocaleString()}

-------- Original Message --------
${emailContent.data?.text || emailContent.data?.html || 'No content available'}
      `,
    });

    console.log('✅ Email forwarded successfully to:', forwardToEmail);
  } catch (error) {
    console.error('❌ Failed to forward email:', error);
    throw error;
  }
}

/**
 * Resend webhook handler for receiving and forwarding emails
 * Handles email.received events securely with verification
 */
export const resendWebhookHandler = httpAction(async (_ctx, request) => {
  try {
    // Get webhook secret from environment
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('RESEND_WEBHOOK_SECRET not configured');
      return new Response(
        JSON.stringify({
          error: 'Webhook secret not configured',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // Extract headers for verification
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    // Get raw body for verification and parsing
    const payload = await request.text();

    // Verify webhook signature for security (following Resend best practices)
    const signature =
      headers['svix-signature'] || headers['x-signature-sha256'] || headers['x-resend-signature'];
    if (!signature) {
      console.error('Missing webhook signature header');
      return new Response(
        JSON.stringify({
          error: 'Missing webhook signature',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    const isValidSignature = await _ctx.runAction(
      api.webhooks.verifySignature.verifyWebhookSignature,
      {
        payload,
        signature,
        secret: webhookSecret,
      },
    );
    if (!isValidSignature) {
      console.error('Invalid webhook signature - potential security threat');
      return new Response(
        JSON.stringify({
          error: 'Invalid webhook signature',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    console.log('✅ Webhook signature verified');

    // Parse the event
    const event: ResendEmailReceivedEvent = JSON.parse(payload);

    // Only process email.received events
    if (event.type !== 'email.received') {
      console.log(`Ignoring event type: ${event.type}`);
      return new Response(
        JSON.stringify({
          message: 'Event type not handled',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // Forward the email to your inbox
    await forwardEmail(event);

    // Return success response
    return new Response(
      JSON.stringify({
        message: 'Email forwarded successfully',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('Error processing webhook:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
});
