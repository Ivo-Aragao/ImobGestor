import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { sendEmail, escapeHtml } from '../lib/mailer.js';
import { runAutomationTrigger } from '../lib/automation-engine.js';

const router = Router();
function localDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function fortalezaWindow(key) {
  const start = new Date(`${key}T00:00:00-03:00`);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return { start, end };
}
router.get('/daily', async (req, res, next) => {
  try {
    const secret = process.env.CRON_SECRET;
    const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query.secret;
    if (!secret || supplied !== secret) return res.status(401).json({ error: 'Não autorizado.' });
    const tomorrow = new Date(`${localDateKey(new Date(Date.now() + 86400000))}T00:00:00-03:00`);
    const { start, end } = fortalezaWindow(localDateKey(tomorrow));
    const expiryLimit = new Date(start.getTime() + 30 * 86400000);
    const expiringDocuments = await prisma.document.findMany({ where: { expiresAt: { lte: expiryLimit } }, include: { tenant: true, case: { include: { client: { select: { name: true, email: true } } } } }, take: 1000 });
    const overdueFinance = await prisma.financialEntry.updateMany({ where: { type: 'RECEIVABLE', status: 'OPEN', dueAt: { lt: start } }, data: { status: 'OVERDUE' } });
    const tasks = await prisma.task.findMany({ where: { status: { in: ['TODO', 'IN_PROGRESS'] }, dueAt: { gte: start, lt: end }, reminderSentAt: null }, include: { tenant: true, assignedTo: true } });
    const events = await prisma.calendarEvent.findMany({ where: { status: 'SCHEDULED', startAt: { gte: start, lt: end }, reminderSentAt: null }, include: { tenant: true, assignedTo: true } });
    let notifications = 0;
    const alertDays = new Set([30, 15, 7, 1, 0]);
    for (const doc of expiringDocuments) {
      if (!doc.expiresAt) continue;
      const expires = new Date(doc.expiresAt);
      const expirationDay = Date.UTC(expires.getUTCFullYear(), expires.getUTCMonth(), expires.getUTCDate());
      const todayDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
      const days = Math.round((expirationDay - todayDay) / 86400000);
      const alertKey = days < 0 ? -1 : days;
      if (!(alertDays.has(days) || days < 0) || doc.lastExpiryAlertDay === alertKey) continue;
      await prisma.notification.create({ data: { tenantId: doc.tenantId, userId: null, title: days < 0 ? 'Documento vencido' : 'Documento próximo do vencimento', message: `${doc.title} — ${doc.case.title} (${days < 0 ? `${Math.abs(days)} dia(s) vencido` : `vence em ${days} dia(s)`})`, link: '/documents', type: days <= 7 ? 'WARNING' : 'INFO' } });
      if (doc.tenant.email) await sendEmail({ to: doc.tenant.email, subject: 'Alerta de validade documental — ImobGestor', text: `O documento ${doc.title} do procedimento ${doc.case.title} ${days < 0 ? 'está vencido' : `vence em ${days} dia(s)`}.`, html: `<p>O documento <strong>${escapeHtml(doc.title)}</strong> do procedimento <strong>${escapeHtml(doc.case.title)}</strong> ${days < 0 ? 'está vencido' : `vence em ${days} dia(s)`}.</p>` }).catch(e => console.error('[cron-email]', e.message));
      await prisma.document.update({ where: { id: doc.id }, data: { expiryAlertSentAt: new Date(), lastExpiryAlertDay: alertKey } });
      await runAutomationTrigger(doc.tenantId, 'DOCUMENT_EXPIRING', { caseTitle: doc.case.title, documentName: doc.title, title: doc.title, message: `Documento com vencimento ${days < 0 ? 'vencido' : `em ${days} dia(s)`}: ${doc.title}`, daysUntilDue: days, tenantEmail: doc.tenant.email, clientName: doc.case.client.name, clientEmail: doc.case.client.email });
      notifications++;
    }
    for (const task of tasks) {
      await prisma.notification.create({ data: { tenantId: task.tenantId, userId: task.assignedToId, title: 'Tarefa vence amanhã', message: task.title, link: '/tasks', type: 'WARNING' } });
      if (task.assignedTo?.email) await sendEmail({ to: task.assignedTo.email, subject: 'Lembrete de tarefa — ImobGestor', text: `A tarefa "${task.title}" vence amanhã.`, html: `<p>A tarefa <strong>${escapeHtml(task.title)}</strong> vence amanhã.</p>` }).catch(e => console.error('[cron-email]', e.message));
      await prisma.task.update({ where: { id: task.id }, data: { reminderSentAt: new Date() } });
      const office = await prisma.tenant.findUnique({ where: { id: task.tenantId }, select: { email: true } });
      await runAutomationTrigger(task.tenantId, 'TASK_DUE_TOMORROW', { title: task.title, message: task.title, assignedToId: task.assignedToId, assignedToEmail: task.assignedTo?.email, tenantEmail: office?.email, caseId: task.caseId });
      notifications++;
    }
    for (const event of events) {
      await prisma.notification.create({ data: { tenantId: event.tenantId, userId: event.assignedToId, title: 'Compromisso amanhã', message: event.title, link: '/calendar', type: 'INFO' } });
      if (event.assignedTo?.email) await sendEmail({ to: event.assignedTo.email, subject: 'Lembrete de compromisso — ImobGestor', text: `O compromisso "${event.title}" está agendado para amanhã.`, html: `<p>O compromisso <strong>${escapeHtml(event.title)}</strong> está agendado para amanhã.</p>` }).catch(e => console.error('[cron-email]', e.message));
      await prisma.calendarEvent.update({ where: { id: event.id }, data: { reminderSentAt: new Date() } }); notifications++;
    }
    return res.json({ success: true, date: start.toISOString().slice(0, 10), tasks: tasks.length, events: events.length, expiringDocuments: expiringDocuments.length, overdueFinance: overdueFinance.count, notifications });
  } catch (error) { next(error); }
});
export default router;
