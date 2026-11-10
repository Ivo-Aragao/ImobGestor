
import { useEffect, useState } from 'react';
import { Activity, Plus, Power, Zap } from 'lucide-react';
import { api, getErrorMessage } from '../services/api';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import {
  EmptyState,
  ErrorMessage,
  SuccessMessage,
} from '../components/Feedback';

const triggers = {
  TASK_CREATED: 'Tarefa criada',
  TASK_DUE_TOMORROW: 'Tarefa vence amanhã',
  DOCUMENT_RECEIVED: 'Documento recebido',
  DOCUMENT_EXPIRING: 'Documento próximo do vencimento',
  CASE_STAGE_COMPLETED: 'Etapa concluída',
  CASE_STATUS_CHANGED: 'Procedimento criado / alterado',
};

const actions = {
  IN_APP_NOTIFICATION: 'Criar notificação interna',
  SEND_EMAIL: 'Enviar e-mail',
  CREATE_TASK: 'Criar tarefa automaticamente',
};

const blank = {
  name: '',
  description: '',
  trigger: 'DOCUMENT_RECEIVED',
  action: 'IN_APP_NOTIFICATION',
  title: '',
  message: '',
  subject: '',
  to: 'OFFICE',
  target: 'OFFICE',
  type: 'INFO',
  dueInDays: '1',
  descriptionTask: '',
};

/* Variáveis disponíveis para personalização */

function AutomationVariables({ onInsert }) {
  const variables = [
    { label: 'Cliente', value: '{{clientName}}' },
    { label: 'Procedimento', value: '{{caseTitle}}' },
    { label: 'Documento', value: '{{documentName}}' },
  ];

  return (
    <div className="automation-variables full-field">
      <strong>Personalize sua mensagem</strong>

      <span className="automation-variables-description">
        Clique para inserir uma informação automaticamente no texto.
      </span>

      <div className="automation-variable-list">
        {variables.map((variable) => (
          <button
            key={variable.value}
            type="button"
            className="automation-variable-button"
            onClick={() => onInsert(variable.value)}
          >
            <Plus size={14} />
            {variable.label}
          </button>
        ))}
      </div>
    </div>
  );
}


export default function AutomationsPage() {
  const [items, setItems] = useState([]);
  const [runs, setRuns] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(blank);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { data } = await api.get('/automations');
      setItems(data.items);
      setRuns(data.runs);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  
function insertVariable(value) {
  setForm((current) => ({
    ...current,
    message: current.message
      ? `${current.message}${current.message.endsWith(' ') ? '' : ' '}${value}`
      : value,
  }));
}

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');

    const config =
      form.action === 'SEND_EMAIL'
        ? {
            to: form.to,
            subject: form.subject || form.title || form.name,
            message: form.message,
          }
        : form.action === 'CREATE_TASK'
          ? {
              title: form.title,
              description: form.descriptionTask,
              dueInDays: Number(form.dueInDays),
            }
          : {
              title: form.title || form.name,
              message: form.message,
              target: form.target,
              type: form.type,
              link: '/notifications',
            };

    try {
      await api.post('/automations', {
        name: form.name,
        description: form.description,
        trigger: form.trigger,
        action: form.action,
        config,
      });

      setShow(false);
      setForm(blank);
      setSuccess('Regra de automação criada.');
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(rule) {
    try {
      await api.patch(`/automations/${rule.id}`, {
        isActive: !rule.isActive,
      });
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function disable(rule) {
    if (!window.confirm(`Desativar a automação "${rule.name}"?`)) {
      return;
    }

    try {
      await api.delete(`/automations/${rule.id}`);
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="REGRAS DO ESCRITÓRIO"
        title="Automações"
        description="Crie ações automáticas para eventos dos procedimentos, tarefas e documentos."
        action={
          <button
            className="button button-primary"
            onClick={() => setShow(true)}
          >
            <Plus size={17} />
            Nova automação
          </button>
        }
      />

      <ErrorMessage>{error}</ErrorMessage>
      <SuccessMessage>{success}</SuccessMessage>

      <div className="notice-box section-gap">
        As regras são executadas quando o evento correspondente ocorre ou
        pela rotina diária. As ações disponíveis nesta versão são
        notificações internas, e-mails e criação de tarefas. Nenhuma regra
        executa código arbitrário.
      </div>

      {/* Regras cadastradas */}
      <section className="panel section-gap">
        <div className="panel-heading">
          <div>
            <h2>Regras cadastradas</h2>
            <p>{items.length} automação(ões)</p>
          </div>
          <Zap size={20} className="muted-icon" />
        </div>

        {items.length ? (
          items.map((rule) => (
            <article className="automation-row" key={rule.id}>
              <div className="automation-icon">
                <Zap size={18} />
              </div>

              <div className="automation-main">
                <strong>{rule.name}</strong>
                <span>
                  {triggers[rule.trigger] || rule.trigger}
                  {' → '}
                  {actions[rule.action] || rule.action}
                </span>
                {rule.description && <small>{rule.description}</small>}
              </div>

              <span
                className={`status-pill ${
                  rule.isActive ? 'status-active' : 'status-inactive'
                }`}
              >
                {rule.isActive ? 'Ativa' : 'Inativa'}
              </span>

              <button
                className="icon-button"
                title={rule.isActive ? 'Desativar' : 'Ativar'}
                onClick={() => toggle(rule)}
              >
                <Power size={16} />
              </button>

              <button
                className="button button-secondary button-small"
                onClick={() => disable(rule)}
              >
                Arquivar
              </button>
            </article>
          ))
        ) : (
          <EmptyState
            title="Nenhuma automação configurada"
            description="Crie uma regra para reduzir tarefas repetitivas no escritório."
          />
        )}
      </section>

      {/* Execuções recentes */}
      <section className="panel section-gap">
        <div className="panel-heading">
          <div>
            <h2>Execuções recentes</h2>
            <p>Histórico das últimas 30 execuções</p>
          </div>
          <Activity size={19} className="muted-icon" />
        </div>

        {runs.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Automação</th>
                  <th>Evento</th>
                  <th>Resultado</th>
                  <th>Data</th>
                </tr>
              </thead>

              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>{run.rule?.name || 'Regra removida'}</td>
                    <td>{triggers[run.trigger] || run.trigger}</td>
                    <td>
                      <span
                        className={`status-pill ${
                          run.status === 'SUCCESS'
                            ? 'status-active'
                            : 'status-inactive'
                        }`}
                      >
                        {run.status === 'SUCCESS' ? 'Concluída' : 'Falhou'}
                      </span>

                      {run.error && <small>{run.error}</small>}
                    </td>
                    <td>
                      {new Date(run.createdAt).toLocaleString('pt-BR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Nenhuma execução registrada"
            description="As execuções aparecerão aqui quando os eventos ocorrerem."
          />
        )}
      </section>

      {/* Modal de nova automação */}
      {show && (
        <Modal
          title="Nova regra de automação"
          onClose={() => setShow(false)}
        >
          <form className="form-grid" onSubmit={submit}>
            <label className="full-field">
              Nome da regra
              <input
                required
                minLength="2"
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.target.value })
                }
                placeholder="Ex.: Avisar quando documento chegar"
              />
            </label>

            <label className="full-field">
              Descrição
              <textarea
                rows="2"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="Descreva o objetivo desta automação."
              />
            </label>

            <label className="full-field">
              Quando executar
              <select
                value={form.trigger}
                onChange={(e) =>
                  setForm({ ...form, trigger: e.target.value })
                }
              >
                {Object.entries(triggers).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="full-field">
              Ação
              <select
                value={form.action}
                onChange={(e) =>
                  setForm({ ...form, action: e.target.value })
                }
              >
                {Object.entries(actions).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            {/* Configuração de e-mail */}
            {form.action === 'SEND_EMAIL' ? (
              <>
                <label>
                  Destinatário
                  <select
                    value={form.to}
                    onChange={(e) =>
                      setForm({ ...form, to: e.target.value })
                    }
                  >
                    <option value="OFFICE">E-mail do escritório</option>
                    <option value="CLIENT">E-mail do cliente</option>
                    <option value="ASSIGNEE">E-mail do responsável</option>
                  </select>
                </label>

                <label>
                  Assunto
                  <input
                    value={form.subject}
                    onChange={(e) =>
                      setForm({ ...form, subject: e.target.value })
                    }
                    placeholder="Atualização do procedimento"
                  />
                </label>

                <label className="full-field">
                  Mensagem
                  <textarea
                    rows="3"
                    value={form.message}
                    onChange={(e) =>
                      setForm({ ...form, message: e.target.value })
                    }
                    placeholder="Digite a mensagem do e-mail..."
                  />
                </label>

                <AutomationVariables onInsert={insertVariable} />
              </>
            ) : form.action === 'CREATE_TASK' ? (
              /* Configuração de tarefa */
              <>
                <label className="full-field">
                  Título da tarefa
                  <input
                    required
                    value={form.title}
                    onChange={(e) =>
                      setForm({ ...form, title: e.target.value })
                    }
                    placeholder="Ex.: Conferir documentação do cliente"
                  />
                </label>

                <label className="full-field">
                  Descrição
                  <textarea
                    rows="2"
                    value={form.descriptionTask}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        descriptionTask: e.target.value,
                      })
                    }
                    placeholder="Descreva o que deverá ser realizado."
                  />
                </label>

                <label>
                  Vencimento em dias
                  <input
                    type="number"
                    min="0"
                    max="365"
                    value={form.dueInDays}
                    onChange={(e) =>
                      setForm({ ...form, dueInDays: e.target.value })
                    }
                  />
                </label>
              </>
            ) : (
              /* Configuração de notificação interna */
              <>
                <label className="full-field">
                  Título
                  <input
                    value={form.title}
                    onChange={(e) =>
                      setForm({ ...form, title: e.target.value })
                    }
                    placeholder="Aviso do ImobGestor"
                  />
                </label>

                <label className="full-field">
                  Mensagem
                  <textarea
                    rows="3"
                    value={form.message}
                    onChange={(e) =>
                      setForm({ ...form, message: e.target.value })
                    }
                    placeholder="Digite a mensagem da notificação..."
                  />
                </label>

                <AutomationVariables onInsert={insertVariable} />

                <label>
                  Destinatário
                  <select
                    value={form.target}
                    onChange={(e) =>
                      setForm({ ...form, target: e.target.value })
                    }
                  >
                    <option value="OFFICE">Todo o escritório</option>
                    <option value="ASSIGNEE">Responsável atribuído</option>
                  </select>
                </label>

                <label>
                  Tipo
                  <select
                    value={form.type}
                    onChange={(e) =>
                      setForm({ ...form, type: e.target.value })
                    }
                  >
                    <option value="INFO">Informação</option>
                    <option value="WARNING">Atenção</option>
                  </select>
                </label>
              </>
            )}

            {/* Botões */}
            <div className="form-actions full-field">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setShow(false)}
              >
                Cancelar
              </button>

              <button
                className="button button-primary"
                disabled={busy}
              >
                {busy ? 'Salvando...' : 'Criar automação'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
