
import { useEffect, useState } from 'react';
import { api, getErrorMessage } from '../services/api';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import {
  EmptyState,
  ErrorMessage,
  SuccessMessage,
} from '../components/Feedback';
import {
  Download,
  FileText,
  Plus,
  Globe,
  Lock,
} from 'lucide-react';

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

export default function DocumentsPage() {
  const [items, setItems] = useState([]);
  const [cases, setCases] = useState([]);
  const [show, setShow] = useState(false);

  const [form, setForm] = useState({
    caseId: '',
    requestId: '',
    title: '',
    expiresAt: '',
  });

  const [file, setFile] = useState(null);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [docs, caseList] = await Promise.all([
        api.get('/documents'),
        api.get('/cases'),
      ]);

      setItems(docs.data.items || []);
      setCases(caseList.data.items || []);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function upload(e) {
    e.preventDefault();

    if (!file || !form.caseId) {
      setError('Selecione um procedimento e um arquivo.');
      return;
    }

    setBusy(true);
    setError('');
    setSuccess('');

    try {
      const formData = new FormData();

      formData.append('file', file);
      formData.append('caseId', form.caseId);

      if (form.requestId) {
        formData.append('requestId', form.requestId);
      }

      if (form.title.trim()) {
        formData.append('title', form.title.trim());
      }

      if (form.expiresAt) {
        formData.append(
          'expiresAt',
          new Date(
            `${form.expiresAt}T12:00:00`
          ).toISOString()
        );
      }

      await api.post('/documents/upload', formData);

      setSuccess(
        'Documento enviado para armazenamento privado.'
      );

      setShow(false);
      setFile(null);

      setForm({
        caseId: '',
        requestId: '',
        title: '',
        expiresAt: '',
      });

      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function changeVisibility(doc, visibility) {
    setError('');
    setSuccess('');

    try {
      await api.patch(
        `/documents/${doc.id}/visibility`,
        { visibility }
      );

      setSuccess(
        visibility === 'CLIENT'
          ? 'Documento publicado no portal do cliente.'
          : 'Documento ocultado do portal.'
      );

      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function download(doc) {
    setError('');

    try {
      const { data } = await api.get(
        `/documents/${doc.id}/download`,
        {
          responseType: 'blob',
        }
      );

      const version = doc.versions?.[0];

      downloadBlobFile(
        data,
        version?.originalName || doc.title || 'documento'
      );
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function reviewRequest(request, status) {
    setError('');
    setSuccess('');

    try {
      await api.patch(
        `/document-requests/${request.id}`,
        { status }
      );

      setSuccess('Situação da solicitação atualizada.');

      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  const requests = cases.flatMap((item) =>
    (item.documentRequests || []).map((request) => ({
      ...request,
      caseTitle: item.title,
      clientName: item.client?.name,
    }))
  );

  const selectedCase = cases.find(
    (item) => item.id === form.caseId
  );

  return (
    <>
      <PageHeader
        eyebrow="ARQUIVOS"
        title="Documentos"
        description="Armazene, revise e disponibilize documentos aos clientes com controle de acesso."
        action={
          <button
            className="button button-primary"
            onClick={() => {
              setError('');
              setSuccess('');
              setShow(true);
            }}
          >
            <Plus size={17} />
            Enviar documento
          </button>
        }
      />

      <ErrorMessage>{error}</ErrorMessage>
      <SuccessMessage>{success}</SuccessMessage>

      <section className="panel section-gap">
        <div className="panel-heading">
          <div>
            <h2>Solicitações documentais</h2>
            <p>
              Acompanhe o que foi solicitado e revise os arquivos
              recebidos.
            </p>
          </div>
        </div>

        {requests.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Cliente / procedimento</th>
                  <th>Situação</th>
                  <th>Revisão</th>
                </tr>
              </thead>

              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td>
                      <strong>{request.name}</strong>
                      {request.required && (
                        <small>Obrigatório</small>
                      )}
                    </td>

                    <td>
                      {request.clientName || '—'}
                      <small>{request.caseTitle}</small>
                    </td>

                    <td>
                      <span className="status-pill">
                        {({
                          REQUESTED: 'Solicitado',
                          RECEIVED: 'Recebido',
                          IN_REVIEW: 'Em análise',
                          ACCEPTED: 'Aceito',
                          REJECTED: 'Precisa reenviar',
                        })[request.status] || request.status}
                      </span>
                    </td>

                    <td>
                      <select
                        className="compact-select"
                        value={request.status}
                        onChange={(e) =>
                          reviewRequest(
                            request,
                            e.target.value
                          )
                        }
                      >
                        <option value="REQUESTED">
                          Solicitado
                        </option>
                        <option value="RECEIVED">
                          Recebido
                        </option>
                        <option value="IN_REVIEW">
                          Em análise
                        </option>
                        <option value="ACCEPTED">
                          Aceito
                        </option>
                        <option value="REJECTED">
                          Precisa reenviar
                        </option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Nenhuma solicitação documental"
            description="As listas configuradas nos modelos de serviço aparecerão aqui."
          />
        )}
      </section>

      <section className="panel">
        {items.length ? (
          <div className="document-list">
            {items.map((doc) => {
              const version = doc.versions?.[0];

              return (
                <div
                  className="document-row"
                  key={doc.id}
                >
                  <div className="document-type-icon">
                    <FileText size={19} />
                  </div>

                  <div className="document-main">
                    <strong>{doc.title}</strong>

                    <span>
                      {version?.originalName || 'Arquivo'}
                      {' · '}
                      {doc.case?.title || 'Sem procedimento'}
                      {' · '}
                      {doc.client?.name || 'Cliente não informado'}
                    </span>

                    <small>
                      {version?.createdAt
                        ? new Date(
                            version.createdAt
                          ).toLocaleString('pt-BR')
                        : ''}

                      {doc.expiresAt
                        ? ` · Validade: ${new Date(
                            doc.expiresAt
                          ).toLocaleDateString('pt-BR')}`
                        : ''}
                    </small>
                  </div>

                  <span
                    className={`visibility-pill ${
                      doc.visibility === 'CLIENT'
                        ? 'published'
                        : ''
                    }`}
                  >
                    {doc.visibility === 'CLIENT' ? (
                      <>
                        <Globe size={13} />
                        Portal
                      </>
                    ) : (
                      <>
                        <Lock size={13} />
                        Interno
                      </>
                    )}
                  </span>

                  <div className="document-actions">
                    <button
                      className="icon-button"
                      title="Baixar"
                      onClick={() => download(doc)}
                    >
                      <Download size={17} />
                    </button>

                    <button
                      className="button button-secondary button-small"
                      onClick={() =>
                        changeVisibility(
                          doc,
                          doc.visibility === 'CLIENT'
                            ? 'INTERNAL'
                            : 'CLIENT'
                        )
                      }
                    >
                      {doc.visibility === 'CLIENT'
                        ? 'Ocultar'
                        : 'Publicar'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="Nenhum documento armazenado"
            description="Envie o primeiro documento ou aguarde o envio de arquivos pelo portal do cliente."
          />
        )}
      </section>

      {show && (
        <Modal
          title="Enviar documento"
          onClose={() => {
            if (busy) return;
            setShow(false);
          }}
        >
          <form
            className="form-grid"
            onSubmit={upload}
          >
            <label className="full-field">
              Procedimento

              <select
                required
                value={form.caseId}
                onChange={(e) =>
                  setForm({
                    ...form,
                    caseId: e.target.value,
                    requestId: '',
                  })
                }
              >
                <option value="">
                  Selecione um procedimento
                </option>

                {cases.map((item) => (
                  <option
                    value={item.id}
                    key={item.id}
                  >
                    {item.title} — {item.client?.name || 'Cliente'}
                  </option>
                ))}
              </select>
            </label>

            <label className="full-field">
              Vincular a uma solicitação (opcional)

              <select
                value={form.requestId}
                onChange={(e) =>
                  setForm({
                    ...form,
                    requestId: e.target.value,
                  })
                }
              >
                <option value="">
                  Nenhuma solicitação específica
                </option>

                {selectedCase?.documentRequests?.map(
                  (request) => (
                    <option
                      key={request.id}
                      value={request.id}
                    >
                      {request.name}
                    </option>
                  )
                )}
              </select>
            </label>

            <label className="full-field">
              Título para exibição

              <input
                value={form.title}
                onChange={(e) =>
                  setForm({
                    ...form,
                    title: e.target.value,
                  })
                }
                placeholder="Ex.: Certidão atualizada"
              />
            </label>

            <label>
              Validade do documento (opcional)

              <input
                type="date"
                value={form.expiresAt}
                onChange={(e) =>
                  setForm({
                    ...form,
                    expiresAt: e.target.value,
                  })
                }
              />
            </label>

            <label className="full-field">
              Arquivo (PDF, JPG ou PNG)

              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                required
                disabled={busy}
                onChange={(e) =>
                  setFile(e.target.files?.[0] || null)
                }
              />
            </label>

            {file && (
              <div className="notice-box full-field">
                {file.name}
                {' · '}
                {(file.size / 1024 / 1024).toFixed(2)}
                {' MB'}
              </div>
            )}

            <div className="form-actions full-field">
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() => setShow(false)}
              >
                Cancelar
              </button>

              <button
                className="button button-primary"
                disabled={busy || !file || !form.caseId}
              >
                {busy ? 'Enviando...' : 'Enviar para nuvem'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
