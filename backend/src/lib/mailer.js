
import { google } from 'googleapis';
import { prisma } from './prisma.js';
import { decryptSecret } from './secure-secrets.js';
import { randomBytes } from 'node:crypto';

const PROVIDER = 'GOOGLE_GMAIL';

function createOAuthClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } =
    process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new Error('Credenciais OAuth do Google não configuradas.');
  }

  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

function safeHeader(value, field) {
  const result = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

  if (!result) {
    throw new Error(`${field} não informado.`);
  }

  return result;
}

function encodeHeader(value) {
  const clean = safeHeader(value, 'Cabeçalho');

  if (/^[\x20-\x7E]*$/.test(clean)) {
    return clean;
  }

  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function encodeBody(value) {
  const base64 = Buffer.from(String(value), 'utf8').toString('base64');

  return base64.match(/.{1,76}/g)?.join('\r\n') || '';
}

function htmlToText(html = '') {
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .trim();
}

function buildMimeMessage({ to, subject, html, text, senderEmail }) {
  const recipients = (Array.isArray(to) ? to : [to])
    .filter(Boolean)
    .map((address) => safeHeader(address, 'Destinatário'));

  if (!recipients.length) {
    throw new Error('Informe pelo menos um destinatário.');
  }

  for (const address of recipients) {
    if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address)) {
      throw new Error('Um dos endereços de e-mail é inválido.');
    }
  }

  if (!html && !text) {
    throw new Error('O conteúdo do e-mail não foi informado.');
  }

  const plainText = text ?? htmlToText(html);
  const htmlContent = html ?? `<pre>${escapeHtml(plainText)}</pre>`;
  const boundary = `imobgestor_${cryptoRandomId()}`;

  const headers = [
    `From: ${safeHeader(process.env.GOOGLE_SENDER_NAME || 'ImobGestor', 'Remetente')} <${senderEmail}>`,
    `To: ${recipients.join(', ')}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodeBody(plainText),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodeBody(htmlContent),
    `--${boundary}--`,
  ];

  return [...headers, '', ...parts].join('\r\n');
}

function cryptoRandomId() {
  return randomBytes(16).toString('hex');
}

export async function sendEmail({ to, subject, html, text }) {
  const credential = await prisma.integrationCredential.findUnique({
    where: { provider: PROVIDER },
  });

  if (!credential) {
    console.warn('[mailer] Gmail ainda não está conectado.');

    return {
      sent: false,
      reason: 'MAIL_NOT_CONFIGURED',
    };
  }

  try {
    const refreshToken = decryptSecret(credential.encryptedRefreshToken);
    const oauth = createOAuthClient();

    oauth.setCredentials({
      refresh_token: refreshToken,
    });

    const gmail = google.gmail({
      version: 'v1',
      auth: oauth,
    });

    const mimeMessage = buildMimeMessage({
      to,
      subject,
      html,
      text,
      senderEmail: credential.accountEmail,
    });

    const raw = Buffer.from(mimeMessage, 'utf8').toString('base64url');

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    return {
      sent: true,
      id: response.data.id,
      threadId: response.data.threadId,
    };
  } catch (error) {
    const message =
      error?.response?.data?.error?.message ||
      error?.message ||
      'Erro desconhecido ao enviar e-mail.';

    console.error('[mailer] Erro no Gmail:', message);

    throw new Error(`Falha ao enviar e-mail pelo Gmail: ${message}`, {
      cause: error,
    });
  }
}

export async function isMailConfigured() {
  const credential = await prisma.integrationCredential.findUnique({
    where: { provider: PROVIDER },
    select: { provider: true },
  });

  return Boolean(credential);
}

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}
