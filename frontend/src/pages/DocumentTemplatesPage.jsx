
import { useEffect, useState } from 'react';
import {
  Plus,
  FileText,
  Pencil,
  Trash2,
  Eye,
  Download,
} from 'lucide-react';
import { api, getErrorMessage } from '../services/api';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import {
  ErrorMessage,
  SuccessMessage,
  EmptyState,
} from '../components/Feedback';

const blank = {
  name: '',
  category: '',
  description: '',
  body: '',
  variables: [],
};

// Nomes amigáveis exibidos no editor e códigos internos da API.
const TEMPLATE_FIELDS = [
  {
    label: '[Nome do cliente]',
    key: 'client.name',
    description: 'Nome completo do cliente',
  },
  {
    label: '[CPF/CNPJ do cliente]',
    key: 'client.document',
    description: 'CPF ou CNPJ do cliente',
  },
  {
    label: '[Nome do imóvel]',
    key: 'property.title',
    description: 'Identificação do imóvel',
  },
  {
    label: '[Data atual]',
    key: 'today',
    description: 'Data do preenchimento',
  },
];

function toEditorBody(body = '') {
  return body.replace(
    /{{\s*([\w.]+)\s*}}/g,
    (match, key) => {
      const field = TEMPLATE_FIELDS.find(
        (item) => item.key === key
      );

      return field ? field.label : match;
    }
  );
}

function toApiBody(body = '') {
  let result = body;

  TEMPLATE_FIELDS.forEach((field) => {
    result = result.replaceAll(
      field.label,
      `{{${field.key}}}`
    );
  });

  return result;
}

export default function DocumentTemplatesPage() {
  const [items, setItems] = useState([]);
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { data } = await api.get('/document-templates');
      setItems(data.items || []);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  function create() {
    setEditing(null);
    setForm({ ...blank });
    setError('');
    setShow(true);
  }

  function edit(item) {
    setEditing(item);

    setForm({
      name: item.name,
      category: item.category || '',
      description: item.description || '',
      body: toEditorBody(item.body),
      variables: Array.isArray(item.variables)
        ? item.variables
        : [],
    });

    setError('');
    setShow(true);
  }

  async function submit(e) {
    e.preventDefault();

    setBusy(true);
    setError('');

    try {
      const apiBody = toApiBody(form.body);

      const detectedVariables = [
        ...apiBody.matchAll(/{{\s*([\w.]+)\s*}}/g),
      ].map((match) => match[1]);

      const payload = {
        ...form,
        body: apiBody,
        variables: [
          ...new Set([
            ...form.variables,
            ...detectedVariables,
          ]),
        ],
      };

      if (editing) {
        await api.patch(
          `/document-templates/${editing.id}`,
          payload
        );
      } else {
        await api.post('/document-templates', payload);
      }

      setShow(false);
      setSuccess(
        editing
          ? 'Modelo atualizado.'
          : 'Modelo criado.'
      );

      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(item) {
    if (!confirm(`Arquivar o modelo "${item.name}"?`)) {
      return;
    }

    try {
      await api.delete(`/document-templates/${item.id}`);
      setSuccess('Modelo arquivado.');
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function doPreview(item) {
    try {
      const { data } = await api.post(
        `/document-templates/${item.id}/preview`,
        {
          values: {
            'client.name': 'Nome do cliente',
            'client.document': '000.000.000-00',
            'property.title': 'Identificação do imóvel',
            today: new Date().toLocaleDateString('pt-BR'),
          },
        }
      );

      setPreview({
        name: data.name,
        body: data.preview,
        unresolved: data.unresolved || [],
      });
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  function downloadHtml() {
    if (!preview) return;

    const escapeHtml = (value) =>
      String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]);

    const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${escapeHtml(preview.name)}</title>
</head>
<body style="font:14px Arial;line-height:1.7;max-width:800px;margin:40px auto;white-space:pre-wrap">
${escapeHtml(preview.body)}
</body>
</html>`;

    const url = URL.createObjectURL(
      new Blob([html], {
        type: 'text/html;charset=utf-8',
      })
    );

    const link = document.createElement('a');

    link.href = url;
    link.download = `${preview.name.replace(/[^\w-]+/g, '-')}.html`;
    link.click();

    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        eyebrow="DOCUMENTAÇÃO"
        title="Modelos de documentos"
        description="Crie textos-base reutilizáveis e preencha campos automaticamente durante o atendimento."
        action={
          <button
            className="button button-primary"
            onClick={create}
          >
            <Plus size={17} />
            Novo modelo
          </button>
        }
      />

      <ErrorMessage>{error}</ErrorMessage>
      <SuccessMessage>{success}</SuccessMessage>

      <div className="notice-box">
        Os modelos são conteúdos administrativos editáveis.
        Textos jurídicos devem ser elaborados ou validados pelos
        profissionais responsáveis.
      </div>

      <section className="template-grid">
        {items.length ? (
          items.map((item) => (
            <article
              className="template-card"
              key={item.id}
            >
              <div className="template-card-icon">
                <FileText size={21} />
              </div>

              <div className="template-card-actions">
                <button
                  className="icon-button"
                  onClick={() => doPreview(item)}
                  title="Pré-visualizar"
                >
                  <Eye size={15} />
                </button>

                <button
                  className="icon-button"
                  onClick={() => edit(item)}
                  title="Editar"
                >
                  <Pencil size={15} />
                </button>

                <button
                  className="icon-button danger-hover"
                  onClick={() => remove(item)}
                  title="Arquivar"
                >
                  <Trash2 size={15} />
                </button>
              </div>

              <h3>{item.name}</h3>

              <p>
                {item.description || item.category || 'Sem descrição'}
              </p>

              <small>
                {(item.variables || []).length} campo(s) automático(s)
              </small>

              <button
                className="button button-secondary button-full"
                onClick={() => doPreview(item)}
              >
                Pré-visualizar modelo
              </button>
            </article>
          ))
        ) : (
          <div className="panel">
            <EmptyState
              title="Nenhum modelo cadastrado"
              description="Crie modelos de declarações, requerimentos, contratos e outros documentos."
            />
          </div>
        )}
      </section>

      {show && (
        <Modal
          title={editing ? 'Editar modelo' : 'Novo modelo de documento'}
          wide
          onClose={() => {
            if (!busy) setShow(false);
          }}
        >
          <form
            className="form-grid"
            onSubmit={submit}
          >
            <label>
              Nome do modelo

              <input
                required
                value={form.name}
                onChange={(e) =>
                  setForm({
                    ...form,
                    name: e.target.value,
                  })
                }
                placeholder="Ex.: Declaração de residência"
              />
            </label>

            <label>
              Categoria

              <input
                value={form.category}
                onChange={(e) =>
                  setForm({
                    ...form,
                    category: e.target.value,
                  })
                }
                placeholder="Ex.: Declarações"
              />
            </label>

            <label className="full-field">
              Descrição

              <input
                value={form.description}
                onChange={(e) =>
                  setForm({
                    ...form,
                    description: e.target.value,
                  })
                }
                placeholder="Descreva para que serve este modelo"
              />
            </label>

            <label className="full-field">
              Conteúdo do modelo

              <textarea
                required
                rows="15"
                value={form.body}
                onChange={(e) =>
                  setForm({
                    ...form,
                    body: e.target.value,
                  })
                }
                placeholder={`DECLARAÇÃO

Eu, [Nome do cliente], inscrito(a) no documento [CPF/CNPJ do cliente], declaro...

Imóvel: [Nome do imóvel]
Data: [Data atual]`}
              />
            </label>

            <div className="notice-box full-field">
              <strong>Campos automáticos disponíveis</strong>

              <p>
                Escreva estes nomes no texto. O sistema preencherá
                os dados automaticamente na pré-visualização.
              </p>

              <ul>
                {TEMPLATE_FIELDS.map((field) => (
                  <li key={field.key}>
                    <strong>{field.label}</strong>
                    {' — '}
                    {field.description}
                  </li>
                ))}
              </ul>
            </div>

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
                disabled={busy}
              >
                {busy ? 'Salvando...' : 'Salvar modelo'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {preview && (
        <Modal
          title={`Pré-visualização: ${preview.name}`}
          wide
          onClose={() => setPreview(null)}
        >
          <div className="template-preview">
            {preview.body}
          </div>

          {preview.unresolved.length > 0 && (
            <div className="notice-box">
              Campos sem valor de exemplo:{' '}
              {preview.unresolved.join(', ')}
            </div>
          )}

          <div className="form-actions">
            <button
              className="button button-secondary"
              onClick={() => setPreview(null)}
            >
              Fechar
            </button>

            <button
              className="button button-primary"
              onClick={downloadHtml}
            >
              <Download size={15} />
              Exportar HTML para impressão
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

