
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, getErrorMessage } from '../services/api';
import {
  ErrorMessage,
  EmptyState,
  SuccessMessage,
} from '../components/Feedback';
import {
  FileUp,
  FolderOpen,
  LogOut,
  LockKeyhole,
  Mail,
  ArrowUpRight,
  MessageSquareText,
  Send,
} from 'lucide-react';

const statusLabels = {
  NEW: 'Novo',
  IN_PROGRESS: 'Em andamento',
  WAITING_CLIENT: 'Aguardando você',
  WAITING_EXTERNAL: 'Aguardando órgão externo',
  WAITING_INTERNAL: 'Em análise',
  SUSPENDED: 'Suspenso',
  COMPLETED: 'Concluído',
  CANCELED: 'Cancelado',
};

const requestStatusLabels = {
  OPEN: 'Aberta',
  IN_PROGRESS: 'Em atendimento',
  ANSWERED: 'Respondida',
  CLOSED: 'Encerrada',
};

const stageLabels = {
  PENDING: 'Pendente',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluída',
  BLOCKED: 'Bloqueada',
};

const documentStatusLabels = {
  REQUESTED: 'Pendente',
  RECEIVED: 'Enviado',
  IN_REVIEW: 'Em análise',
  ACCEPTED: 'Aceito',
  REJECTED: 'Precisa reenviar',
};

function downloadBlobFile(blob, fileName) {
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = objectUrl;
  link.download = fileName || 'documento';
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => {
    window.URL.revokeObjectURL(objectUrl);
  }, 1000);
}

export default function PortalPage() {
  const [params] = useSearchParams();

  const isActivation =
    window.location.pathname.endsWith('/activate');

  const [active, setActive] = useState(false);
  const [client, setClient] = useState(null);
  const [cases, setCases] = useState([]);
  const [requests, setRequests] = useState([]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  const [requestForm, setRequestForm] = useState({
    subject: '',
    message: '',
    caseId: '',
  });

  const [replyDrafts, setReplyDrafts] = useState({});

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadPortal() {
    try {
      const [me, list, inbox] = await Promise.all([
        api.get('/portal/me'),
        api.get('/portal/cases'),
        api.get('/portal/requests'),
      ]);

      setClient(me.data.client);
      setCases(list.data.items || []);
      setRequests(inbox.data.items || []);
      setActive(true);
    } catch {
      setActive(false);
    }
  }

  useEffect(() => {
    if (!isActivation) {
      loadPortal();
    }
  }, []);

  async function login(e) {
    e.preventDefault();

    setBusy(true);
    setError('');
    setSuccess('');

    try {
      await api.post('/portal/auth/login', {
        email,
        password,
      });

      await loadPortal();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function activate(e) {
    e.preventDefault();

    setBusy(true);
    setError('');
    setSuccess('');

    try {
      await api.post('/portal/auth/activate', {
        token: params.get('token'),
        name,
        password,
      });

      setSuccess(
        'Conta ativada. Agora você pode entrar no portal.'
      );

      window.location.href = '/portal';
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await api.post('/portal/auth/logout');

      setActive(false);
      setClient(null);
      setCases([]);
      setRequests([]);
      setError('');
      setSuccess('');
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function uploadFile(file, item, request) {
    if (!file) return;

    setError('');
    setSuccess('');
    setBusy(true);

    try {
      const formData = new FormData();

      formData.append('file', file);
      formData.append('caseId', item.id);
      formData.append('requestId', request.id);

      await api.post(
        '/portal/documents/upload',
        formData
      );

      setSuccess(
        `Arquivo enviado para análise: ${file.name}`
      );

      await loadPortal();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function downloadDocument(doc) {
    setError('');

    try {
      const { data } = await api.get(
        `/portal/documents/${doc.id}/download`,
        {
          responseType: 'blob',
        }
      );

      downloadBlobFile(
        data,
        doc.title || 'documento'
      );
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function createRequest(e) {
    e.preventDefault();

    setBusy(true);
    setError('');
    setSuccess('');

    try {
      await api.post('/portal/requests', {
        ...requestForm,
        caseId: requestForm.caseId || null,
      });

      setRequestForm({
        subject: '',
        message: '',
        caseId: '',
      });

      setSuccess('Solicitação enviada ao escritório.');

      await loadPortal();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function replyRequest(requestId) {
    const message = (
      replyDrafts[requestId] || ''
    ).trim();

    if (!message) return;

    setBusy(true);
    setError('');
    setSuccess('');

    try {
      await api.post(
        `/portal/requests/${requestId}/messages`,
        { message }
      );

      setReplyDrafts((old) => ({
        ...old,
        [requestId]: '',
      }));

      await loadPortal();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (active) {
    return (
      <div className="portal-screen">
        <header className="portal-header">
          <div className="brand-lockup">
            <div className="brand-mark">IG</div>

            <strong>
              ImobGestor
              <small>Portal do cliente</small>
            </strong>
          </div>

          <button
            className="button button-secondary"
            onClick={logout}
          >
            <LogOut size={16} />
            Sair
          </button>
        </header>

        <main className="portal-main">
          <div className="portal-welcome">
            <span className="eyebrow">
              ÁREA DO CLIENTE
            </span>

            <h1>
              Olá, {client?.name?.split(' ')[0]}!
            </h1>

            <p>
              Acompanhe seus serviços, envie documentos e converse
              com o escritório.
            </p>
          </div>

          <ErrorMessage>{error}</ErrorMessage>
          <SuccessMessage>{success}</SuccessMessage>

          {cases.length ? (
            <div className="portal-cases">
              {cases.map((item) => (
                <article
                  className="portal-case-card"
                  key={item.id}
                >
                  <div className="portal-case-top">
                    <div className="property-symbol">
                      <FolderOpen size={20} />
                    </div>

                    <span
                      className={`status-pill status-${item.status.toLowerCase()}`}
                    >
                      {statusLabels[item.status]}
                    </span>
                  </div>

                  <h2>{item.title}</h2>

                  <p>
                    {item.template.name}
                    {' · '}
                    {item.property.title}
                    {' · '}
                    {item.property.city}/{item.property.state}
                  </p>

                  <div className="portal-stage-list">
                    <strong>Etapas compartilhadas</strong>

                    {item.stages.map((stage) => (
                      <div
                        className="portal-stage"
                        key={`${item.id}-${stage.order}`}
                      >
                        <span
                          className={`portal-stage-dot ${stage.status.toLowerCase()}`}
                        />

                        <span>{stage.name}</span>

                        <small>
                          {stageLabels[stage.status]}
                        </small>
                      </div>
                    ))}
                  </div>

                  {item.documentRequests?.length > 0 && (
                    <div className="portal-requests">
                      <strong>Documentos solicitados</strong>

                      {item.documentRequests.map((request) => (
                        <div
                          className="portal-request"
                          key={request.id}
                        >
                          <div>
                            <b>
                              {request.name}
                              {request.required ? ' *' : ''}
                            </b>

                            <small>
                              {request.instructions ||
                                'Envie um arquivo legível em PDF, JPG ou PNG.'}
                            </small>

                            <span
                              className={`status-pill status-${request.status.toLowerCase()}`}
                            >
                              {documentStatusLabels[request.status]}
                            </span>
                          </div>

                          {['REQUESTED', 'REJECTED'].includes(
                            request.status
                          ) && (
                            <label className="upload-button">
                              <FileUp size={16} />
                              Enviar arquivo

                              <input
                                type="file"
                                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                                disabled={busy}
                                onChange={(e) => {
                                  const selectedFile =
                                    e.target.files?.[0];

                                  uploadFile(
                                    selectedFile,
                                    item,
                                    request
                                  );

                                  e.target.value = '';
                                }}
                              />
                            </label>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {item.documents?.length > 0 && (
                    <div className="portal-shared-docs">
                      <strong>
                        Documentos disponibilizados
                      </strong>

                      {item.documents.map((doc) => (
                        <div key={doc.id}>
                          {doc.title}

                          <button
                            className="text-link"
                            onClick={() =>
                              downloadDocument(doc)
                            }
                          >
                            Baixar
                            <ArrowUpRight size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Nenhum serviço disponível"
              description="Quando o escritório vincular um procedimento ao seu cadastro, ele aparecerá aqui."
            />
          )}

          <section className="panel portal-support-panel">
            <div className="panel-heading">
              <div>
                <h2>Solicitar atendimento</h2>
                <p>
                  Envie uma dúvida ou solicitação diretamente ao
                  escritório.
                </p>
              </div>

              <MessageSquareText size={19} />
            </div>

            <form
              className="form-grid"
              onSubmit={createRequest}
            >
              <label>
                Assunto

                <input
                  required
                  minLength={3}
                  maxLength={160}
                  value={requestForm.subject}
                  onChange={(e) =>
                    setRequestForm({
                      ...requestForm,
                      subject: e.target.value,
                    })
                  }
                  placeholder="Ex.: Dúvida sobre documentação"
                />
              </label>

              <label>
                Procedimento relacionado

                <select
                  value={requestForm.caseId}
                  onChange={(e) =>
                    setRequestForm({
                      ...requestForm,
                      caseId: e.target.value,
                    })
                  }
                >
                  <option value="">
                    Atendimento geral
                  </option>

                  {cases.map((item) => (
                    <option
                      key={item.id}
                      value={item.id}
                    >
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>

              <label className="full-field">
                Mensagem

                <textarea
                  required
                  minLength={5}
                  maxLength={5000}
                  rows={3}
                  value={requestForm.message}
                  onChange={(e) =>
                    setRequestForm({
                      ...requestForm,
                      message: e.target.value,
                    })
                  }
                  placeholder="Descreva como o escritório pode ajudar."
                />
              </label>

              <div className="form-actions full-field">
                <button
                  className="button button-primary"
                  disabled={busy}
                >
                  {busy
                    ? 'Enviando...'
                    : 'Enviar solicitação'}
                </button>
              </div>
            </form>
          </section>

          <section className="panel portal-support-panel">
            <div className="panel-heading">
              <div>
                <h2>Minhas solicitações</h2>
                <p>
                  Acompanhe as respostas do escritório.
                </p>
              </div>

              <FolderOpen size={19} />
            </div>

            {requests.length ? (
              requests.map((request) => (
                <article
                  className="portal-request-thread"
                  key={request.id}
                >
                  <div className="portal-request-head">
                    <div>
                      <strong>{request.subject}</strong>

                      <small>
                        {request.case?.title || 'Atendimento geral'}
                        {' · '}
                        {new Date(
                          request.createdAt
                        ).toLocaleDateString('pt-BR')}
                      </small>
                    </div>

                    <span
                      className={`status-pill status-${request.status.toLowerCase()}`}
                    >
                      {requestStatusLabels[request.status] ||
                        request.status}
                    </span>
                  </div>

                  <div className="portal-message-list">
                    {request.messages.map((message) => (
                      <div
                        className={`portal-message ${
                          message.senderType === 'CLIENT'
                            ? 'mine'
                            : ''
                        }`}
                        key={message.id}
                      >
                        <small>
                          {message.senderType === 'CLIENT'
                            ? 'Você'
                            : 'Escritório'}
                          {' · '}
                          {new Date(
                            message.createdAt
                          ).toLocaleString('pt-BR')}
                        </small>

                        <p>{message.message}</p>
                      </div>
                    ))}
                  </div>

                  {request.status !== 'CLOSED' && (
                    <div className="portal-reply">
                      <textarea
                        rows={2}
                        value={replyDrafts[request.id] || ''}
                        onChange={(e) =>
                          setReplyDrafts((old) => ({
                            ...old,
                            [request.id]: e.target.value,
                          }))
                        }
                        placeholder="Escreva uma resposta..."
                      />

                      <button
                        className="button button-secondary"
                        disabled={
                          busy ||
                          !(replyDrafts[request.id] || '').trim()
                        }
                        onClick={() =>
                          replyRequest(request.id)
                        }
                      >
                        <Send size={15} />
                        Enviar mensagem
                      </button>
                    </div>
                  )}
                </article>
              ))
            ) : (
              <EmptyState
                title="Nenhuma solicitação ainda"
                description="Quando você entrar em contato pelo formulário, a conversa aparecerá aqui."
              />
            )}
          </section>
        </main>

        <footer className="portal-footer">
          Acompanhamento disponibilizado pelo escritório
          responsável. As mensagens ficam registradas no portal.
        </footer>
      </div>
    );
  }

  return (
    <div className="portal-auth-screen">
      <form
        className="portal-auth-card"
        onSubmit={isActivation ? activate : login}
      >
        <div className="brand-lockup">
          <div className="brand-mark">IG</div>

          <strong>
            ImobGestor
            <small>Portal do cliente</small>
          </strong>
        </div>

        <span className="eyebrow">
          {isActivation
            ? 'ATIVAÇÃO DE CONTA'
            : 'ACESSO DO CLIENTE'}
        </span>

        <h1>
          {isActivation
            ? 'Crie sua senha'
            : 'Acompanhe seus serviços'}
        </h1>

        <p className="muted">
          {isActivation
            ? 'Defina seus dados de acesso para consultar as atualizações do escritório.'
            : 'Entre com as credenciais fornecidas ou ativadas junto ao escritório.'}
        </p>

        <ErrorMessage>{error}</ErrorMessage>
        <SuccessMessage>{success}</SuccessMessage>

        {isActivation && (
          <label>
            Seu nome

            <div className="input-wrap">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Nome completo"
              />
            </div>
          </label>
        )}

        {!isActivation && (
          <label>
            E-mail

            <div className="input-wrap">
              <Mail size={17} />

              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="seu@email.com"
              />
            </div>
          </label>
        )}

        <label>
          Senha

          <div className="input-wrap">
            <LockKeyhole size={17} />

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={10}
              placeholder="Mínimo de 10 caracteres"
            />
          </div>
        </label>

        <button
          className="button button-primary button-full"
          disabled={busy}
        >
          {busy
            ? 'Aguarde...'
            : isActivation
              ? 'Ativar conta'
              : 'Entrar no portal'}
        </button>

        <a
          className="portal-back-link"
          href="/login"
        >
          Acesso do escritório
        </a>
      </form>
    </div>
  );
}
