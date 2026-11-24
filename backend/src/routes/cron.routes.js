
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { sendEmail, escapeHtml } from '../lib/mailer.js';
import { runAutomationTrigger } from '../lib/automation-engine.js';

const router = Router();

const DAY_MS = 24 * 60 * 60 * 1000;
const ALERT_DAYS = new Set([30, 15, 7, 1, 0]);

function localDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function fortalezaWindow(key) {
  const start = new Date(`${key}T00:00:00-03:00`);
  const end = new Date(start.getTime() + DAY_MS);

  return { start, end };
}

function getDocumentAlert(doc, targetStart) {
  if (!doc.expiresAt) return null;

  const expires = new Date(doc.expiresAt);

  const expirationDay = Date.UTC(
    expires.getUTCFullYear(),
    expires.getUTCMonth(),
    expires.getUTCDate()
  );

  const targetDay = Date.UTC(
    targetStart.getUTCFullYear(),
    targetStart.getUTCMonth(),
    targetStart.getUTCDate()
  );

  const days = Math.round(
    (expirationDay - targetDay) / DAY_MS
  );

  const alertKey = days < 0 ? -1 : days;

  if (!(ALERT_DAYS.has(days) || days < 0)) {
    return null;
  }

  if (doc.lastExpiryAlertDay === alertKey) {
    return null;
  }

  return { days, alertKey };
}

async function safeSendEmail(params, description) {
  try {
    const result = await sendEmail(params);

    if (result?.sent) {
      console.info(`[cron-email] ${description}: enviado.`);
      return true;
    }

    console.warn(
      `[cron-email] ${description}: envio não realizado. Motivo: ${result?.reason || 'não informado'}.`
    );

    return false;
  } catch (error) {
    console.error(
      `[cron-email] ${description}: ${error.message}`
    );

    return false;
  }
}

router.get('/daily', async (req, res, next) => {
  try {
    // Autenticação da Vercel Cron
    const secret = process.env.CRON_SECRET;
    const supplied = req.headers.authorization?.replace(
      /^Bearer\s+/i,
      ''
    );

    if (!secret || supplied !== secret) {
      return res.status(401).json({
        error: 'Não autorizado.',
      });
    }

    console.info('[cron-daily] Iniciando rotina diária.');

    // Data de referência: amanhã em Fortaleza
    const targetDateKey = localDateKey(
      new Date(Date.now() + DAY_MS)
    );

    const { start, end } = fortalezaWindow(targetDateKey);

    const targetDateLabel = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Fortaleza',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(start);

    // Busca documentos vencidos ou dentro do período de 30 dias
    const expiryLimit = new Date(
      start.getTime() + 31 * DAY_MS - 1
    );

    const expiringDocuments = await prisma.document.findMany({
      where: {
        expiresAt: {
          lte: expiryLimit,
        },
      },
      include: {
        tenant: true,
        case: {
          include: {
            client: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
      },
      take: 1000,
    });

    // Separa somente documentos que realmente precisam de alerta
    const documentsToAlert = expiringDocuments
      .map((doc) => ({
        doc,
        alert: getDocumentAlert(doc, start),
      }))
      .filter((item) => item.alert !== null);

    // Atualiza cobranças financeiras vencidas
    const overdueFinance = await prisma.financialEntry.updateMany({
      where: {
        type: 'RECEIVABLE',
        status: 'OPEN',
        dueAt: {
          lt: start,
        },
      },
      data: {
        status: 'OVERDUE',
      },
    });

    // Busca tarefas com vencimento amanhã
    const tasks = await prisma.task.findMany({
      where: {
        status: {
          in: ['TODO', 'IN_PROGRESS'],
        },
        dueAt: {
          gte: start,
          lt: end,
        },
        reminderSentAt: null,
      },
      include: {
        tenant: true,
        assignedTo: true,
      },
    });

    // Busca compromissos agendados para amanhã
    const events = await prisma.calendarEvent.findMany({
      where: {
        status: 'SCHEDULED',
        startAt: {
          gte: start,
          lt: end,
        },
        reminderSentAt: null,
      },
      include: {
        tenant: true,
        assignedTo: true,
      },
    });

    // Tarefas e compromissos com destinatário de e-mail
    const tasksWithEmail = tasks.filter(
  task => Boolean(task.tenant?.email?.trim())
);

const eventsWithEmail = events.filter(
  event => Boolean(event.tenant?.email?.trim())
);

    // Identifica os escritórios que possuem alertas
    const tenantsWithAlerts = new Set([
      ...documentsToAlert.map(({ doc }) => doc.tenantId),
      ...tasksWithEmail.map((task) => task.tenantId),
      ...eventsWithEmail.map((event) => event.tenantId),
    ]);

    let notifications = 0;

    // Processa documentos
    for (const { doc, alert } of documentsToAlert) {
      const { days, alertKey } = alert;

      await prisma.notification.create({
        data: {
          tenantId: doc.tenantId,
          userId: null,
          title:
            days < 0
              ? 'Documento vencido'
              : 'Documento próximo do vencimento',
          message: `${doc.title} — ${doc.case.title} (${
            days < 0
              ? `${Math.abs(days)} dia(s) vencido`
              : `vence em ${days} dia(s)`
          })`,
          link: '/documents',
          type: days <= 7 ? 'WARNING' : 'INFO',
        },
      });

      if (doc.tenant.email) {
        await safeSendEmail(
          {
            to: doc.tenant.email,
            subject: 'Alerta de validade documental — ImobGestor',
            text: `O documento ${doc.title} do procedimento ${doc.case.title} ${
              days < 0
                ? 'está vencido'
                : `vence em ${days} dia(s)`
            }.`,
            html: `<p>O documento <strong>${escapeHtml(
              doc.title
            )}</strong> do procedimento <strong>${escapeHtml(
              doc.case.title
            )}</strong> ${
              days < 0
                ? 'está vencido'
                : `vence em ${days} dia(s)`
            }.</p>`,
          },
          `alerta de documento ${doc.id}`
        );
      }

      await prisma.document.update({
        where: {
          id: doc.id,
        },
        data: {
          expiryAlertSentAt: new Date(),
          lastExpiryAlertDay: alertKey,
        },
      });

      await runAutomationTrigger(
        doc.tenantId,
        'DOCUMENT_EXPIRING',
        {
          caseTitle: doc.case.title,
          documentName: doc.title,
          title: doc.title,
          message: `Documento com vencimento ${
            days < 0 ? 'vencido' : `em ${days} dia(s)`
          }: ${doc.title}`,
          daysUntilDue: days,
          tenantEmail: doc.tenant.email,
          clientName: doc.case.client.name,
          clientEmail: doc.case.client.email,
        }
      );

      notifications++;
    }

    // Processa tarefas
    for (const task of tasks) {
      await prisma.notification.create({
        data: {
          tenantId: task.tenantId,
          userId: task.assignedToId,
          title: 'Tarefa vence amanhã',
          message: task.title,
          link: '/tasks',
          type: 'WARNING',
        },
      });

      const taskEmail = task.tenant?.email?.trim();

      if (taskEmail) {
        await safeSendEmail(
          {
            to: taskEmail,
            subject: 'Lembrete de tarefa — ImobGestor',
            text: `A tarefa "${task.title}" vence amanhã.`,
            html: `<p>A tarefa <strong>${escapeHtml(
              task.title
            )}</strong> vence amanhã.</p>`,
          },
          `lembrete da tarefa ${task.id}`
        );
      }

      await prisma.task.update({
        where: {
          id: task.id,
        },
        data: {
          reminderSentAt: new Date(),
        },
      });

      const office = await prisma.tenant.findUnique({
        where: {
          id: task.tenantId,
        },
        select: {
          email: true,
        },
      });

      await runAutomationTrigger(
        task.tenantId,
        'TASK_DUE_TOMORROW',
        {
          title: task.title,
          message: task.title,
          assignedToId: task.assignedToId,
          assignedToEmail: task.assignedTo?.email,
          tenantEmail: office?.email,
          caseId: task.caseId,
        }
      );

      notifications++;
    }

    // Processa compromissos
    for (const event of events) {
      await prisma.notification.create({
        data: {
          tenantId: event.tenantId,
          userId: event.assignedToId,
          title: 'Compromisso amanhã',
          message: event.title,
          link: '/calendar',
          type: 'INFO',
        },
      });

      const eventEmail = event.tenant?.email?.trim();

      if (eventEmail) {
        await safeSendEmail(
          {
            to: eventEmail,
            subject: 'Lembrete de compromisso — ImobGestor',
            text: `O compromisso "${event.title}" está agendado para amanhã.`,
            html: `<p>O compromisso <strong>${escapeHtml(
              event.title
            )}</strong> está agendado para amanhã.</p>`,
          },
          `lembrete do compromisso ${event.id}`
        );
      }

      await prisma.calendarEvent.update({
        where: {
          id: event.id,
        },
        data: {
          reminderSentAt: new Date(),
        },
      });

      notifications++;
    }

    // Envia um resumo tranquilizador aos escritórios sem alertas
    const tenants = await prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    let quietEmailsSent = 0;
    let quietEmailsFailed = 0;
    let quietEmailsSkippedNoAddress = 0;

    for (const tenant of tenants) {
      // Se há qualquer alerta aplicável, não envia o resumo de tranquilidade
      if (tenantsWithAlerts.has(tenant.id)) {
        continue;
      }

      const recipient = tenant.email?.trim();

      if (!recipient) {
        quietEmailsSkippedNoAddress++;

        console.warn(
          `[cron-daily] Escritório ${tenant.id} sem e-mail cadastrado para o resumo.`
        );

        continue;
      }

      const greeting = tenant.name
        ? `Olá, ${escapeHtml(tenant.name)}!`
        : 'Olá!';

      const summaryText = [
        tenant.name ? `Olá, ${tenant.name}!` : 'Olá!',
        '',
        `A verificação diária do ImobGestor para ${targetDateLabel} foi concluída.`,
        '',
        'Não foram identificados novos avisos para envio por e-mail referentes a:',
        '- Tarefas com vencimento amanhã e responsável com e-mail cadastrado.',
        '- Compromissos agendados para amanhã e responsável com e-mail cadastrado.',
        '- Documentos que atingem os períodos configurados de alerta ou que já estão vencidos.',
        '',
        'Está tudo tranquilo em relação a essas três verificações!',
        '',
        'A rotina também atualiza cobranças financeiras vencidas. Este resumo não substitui a consulta à área Financeiro.',
        '',
        'Atenciosamente,',
        'Equipe ImobGestor',
      ].join('\n');

      const summaryHtml = `
        <div style="font-family:Arial,sans-serif;color:#26352d;line-height:1.6">
          <p>${greeting}</p>
          <p>A verificação diária do ImobGestor para <strong>${targetDateLabel}</strong> foi concluída.</p>
          <p>Não foram identificados novos avisos para envio por e-mail referentes a:</p>
          <ul>
            <li>Tarefas com vencimento amanhã e responsável com e-mail cadastrado.</li>
            <li>Compromissos agendados para amanhã e responsável com e-mail cadastrado.</li>
            <li>Documentos que atingem os períodos configurados de alerta ou que já estão vencidos.</li>
          </ul>
          <p><strong>Está tudo tranquilo em relação a essas três verificações!</strong></p>
          <p>A rotina também atualiza cobranças financeiras vencidas. Este resumo não substitui a consulta à área Financeiro.</p>
          <p>Atenciosamente,<br>Equipe ImobGestor</p>
        </div>
      `;

      const sent = await safeSendEmail(
        {
          to: recipient,
          subject: 'Resumo diário do ImobGestor: sem alertas',
          text: summaryText,
          html: summaryHtml,
        },
        `resumo diário do escritório ${tenant.id}`
      );

      if (sent) {
        quietEmailsSent++;
      } else {
        quietEmailsFailed++;
      }
    }

    console.info('[cron-daily] Rotina concluída.', {
      date: targetDateKey,
      tasks: tasks.length,
      tasksWithEmail: tasksWithEmail.length,
      events: events.length,
      eventsWithEmail: eventsWithEmail.length,
      documentsChecked: expiringDocuments.length,
      documentsWithAlerts: documentsToAlert.length,
      overdueFinance: overdueFinance.count,
      notifications,
      quietEmailsSent,
      quietEmailsFailed,
      quietEmailsSkippedNoAddress,
    });

    return res.json({
      success: true,
      date: targetDateKey,
      tasks: tasks.length,
      tasksWithEmail: tasksWithEmail.length,
      events: events.length,
      eventsWithEmail: eventsWithEmail.length,
      expiringDocuments: expiringDocuments.length,
      documentsWithAlerts: documentsToAlert.length,
      overdueFinance: overdueFinance.count,
      notifications,
      quietEmailsSent,
      quietEmailsFailed,
      quietEmailsSkippedNoAddress,
    });
  } catch (error) {
    console.error('[cron-daily] Erro na rotina:', error);
    next(error);
  }
});

export default router;
