import { prisma } from './prisma.js';
import { sendEmail, escapeHtml } from './mailer.js';

function safeContext(context = {}) {
  const allowed = ['caseId', 'caseTitle', 'clientId', 'clientName', 'clientEmail', 'assignedToId', 'assignedToEmail', 'tenantEmail', 'title', 'message', 'taskTitle', 'documentName', 'daysUntilDue'];
  return Object.fromEntries(Object.entries(context).filter(([key, value]) => allowed.includes(key) && ['string', 'number', 'boolean'].includes(typeof value)));
}
function render(value, context) {
  return String(value || '').replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key) => String(context[key] ?? ''));
}

export async function runAutomationTrigger(tenantId, trigger, rawContext = {}) {
  const context = safeContext(rawContext);
  const rules = await prisma.automationRule.findMany({ where: { tenantId, trigger, isActive: true } });
  const results = [];

  for (const rule of rules) {
    const startedAt = new Date();
    try {
      const config = rule.config && typeof rule.config === 'object' && !Array.isArray(rule.config) ? rule.config : {};
      let result = {};

      if (rule.action === 'IN_APP_NOTIFICATION') {
        const userId = config.target === 'ASSIGNEE' ? context.assignedToId || null : null;
        await prisma.notification.create({ data: { tenantId, userId, title: render(config.title || rule.name, context), message: render(config.message || context.message || context.title || rule.name, context), link: typeof config.link === 'string' ? config.link : null, type: config.type === 'WARNING' ? 'WARNING' : 'INFO' } });
        result = { notified: true, target: userId || 'OFFICE' };
      } else if (rule.action === 'SEND_EMAIL') {
        const to = config.to === 'ASSIGNEE' ? context.assignedToEmail : config.to === 'OFFICE' ? context.tenantEmail : context.clientEmail;
        if (!to) throw new Error('Não existe e-mail de destinatário disponível no contexto.');
        const subject = render(config.subject || rule.name, context);
        const message = render(config.message || context.message || rule.name, context);
        const sent = await sendEmail({ to, subject, text: message, html: `<p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>` });
        result = { sent: Boolean(sent.sent), recipient: to, reason: sent.reason || null };
      } else if (rule.action === 'CREATE_TASK') {
        const caseId = context.caseId || config.caseId || null;
        const assignedToId = config.assignedToId || context.assignedToId || null;
        if (caseId && !(await prisma.case.findFirst({ where: { id: caseId, tenantId } }))) throw new Error('Procedimento associado não encontrado neste escritório.');
        if (assignedToId && !(await prisma.membership.findFirst({ where: { tenantId, userId: assignedToId, isActive: true } }))) throw new Error('Responsável configurado não pertence ao escritório ou está inativo.');
        const creator = await prisma.membership.findFirst({ where: { tenantId, isActive: true }, orderBy: { createdAt: 'asc' }, select: { userId: true } });
        if (!creator) throw new Error('O escritório não possui usuário ativo para registrar a tarefa automática.');
        const dueAt = config.dueInDays != null ? new Date(Date.now() + Number(config.dueInDays) * 86400000) : null;
        const task = await prisma.task.create({ data: { tenantId, caseId, assignedToId, createdById: creator.userId, title: render(config.title || `Automação: ${rule.name}`, context), description: render(config.description || context.message || '', context), dueAt } });
        result = { taskId: task.id };
      } else {
        throw new Error(`Ação de automação não suportada: ${rule.action}`);
      }

      await prisma.automationRun.create({ data: { tenantId, ruleId: rule.id, trigger, status: 'SUCCESS', context, result, startedAt, finishedAt: new Date() } });
      results.push({ ruleId: rule.id, success: true });
    } catch (error) {
      await prisma.automationRun.create({ data: { tenantId, ruleId: rule.id, trigger, status: 'FAILED', context, error: String(error.message || error).slice(0, 1000), startedAt, finishedAt: new Date() } }).catch(logError => console.error('[automation-run-log]', logError.message));
      results.push({ ruleId: rule.id, success: false, error: error.message });
    }
  }
  return results;
}
