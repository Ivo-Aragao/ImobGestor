
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Cloud,
  Mail,
  PenTool,
  Landmark,
  CreditCard,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock3,
  Send,
  Unplug,
  ExternalLink,
  FileCheck,
  FolderOpen,
  Map,
  Trees,
  Building2,
  FileText,
  ArrowUpRight,
} from 'lucide-react';

import { api, getErrorMessage } from '../services/api';
import PageHeader from '../components/PageHeader';
import { ErrorMessage } from '../components/Feedback';

const sources = [
  {
    title: 'ONR / SAEC',
    category: 'Cartórios de imóveis',
    description:
      'Acesso a serviços de pesquisa imobiliária, certidões digitais e solicitações registrais.',
    detail: 'Matrículas, certidões e pesquisa de bens.',
    url: 'https://registradores.onr.org.br/',
    icon: FileCheck,
  },
  {
    title: 'INCRA / SIGEF',
    category: 'Georreferenciamento rural',
    description:
      'Consulta de parcelas georreferenciadas e certificadas e informações fundiárias.',
    detail: 'Parcelas, áreas e certificações.',
    url: 'https://sigef.incra.gov.br/',
    icon: Map,
  },
  {
    title: 'SNCR / CCIR',
    category: 'Cadastro rural',
    description:
      'Acesso ao cadastro de imóveis rurais e emissão do Certificado de Cadastro de Imóvel Rural.',
    detail: 'Cadastro e emissão do CCIR.',
    url: 'https://sncr.serpro.gov.br/ccir/',
    icon: FileText,
  },
  {
    title: 'SICAR / CAR',
    category: 'Regularização ambiental rural',
    description:
      'Consulta pública de imóveis inscritos no Cadastro Ambiental Rural.',
    detail: 'Reserva Legal, APP e áreas cadastradas.',
    url: 'https://consulta.car.gov.br/',
    icon: Trees,
  },
  {
    title: 'CNIR / CAFIR / CIB',
    category: 'Receita Federal',
    description:
      'Serviços de cadastro e vinculação de informações de imóveis rurais.',
    detail: 'Identificação cadastral e situação do imóvel.',
    url: 'https://www.gov.br/receitafederal/pt-br/assuntos/cadastros-e-registros-especiais/rural',
    icon: Landmark,
  },
];

function StatusBadge({ type, children }) {
  const classes = {
    success: 'integration-badge-success',
    warning: 'integration-badge-warning',
    planned: 'integration-badge-planned',
    external: 'integration-badge-external',
  };

  return (
    <span className={`integration-custom-badge ${classes[type] || ''}`}>
      {children}
    </span>
  );
}

function ExternalButton({ href, children, secondary = false }) {
  return (
    <a
      className={`button ${secondary ? 'button-secondary' : 'button-primary'} integration-action`}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
      <ExternalLink size={14} />
    </a>
  );
}

export default function IntegrationsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState('');

  const emailConnected = Boolean(
    data?.emailConnected ?? data?.email
  );

  async function load() {
    try {
      setError('');
      const response = await api.get('/integrations/status');
      setData(response.data);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('google');

    if (result === 'connected') {
      setSuccess('Sua conta Google foi conectada com sucesso!');
    }

    if (result === 'error') {
      setError(
        'Não foi possível concluir a conexão Google. Verifique o terminal do backend.'
      );
    }

    if (result) {
      params.delete('google');
      const query = params.toString();

      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
      );
    }

    load();
  }, []);

  async function connectGoogle() {
    setBusy('connect');
    setError('');
    setSuccess('');

    try {
      const response = await api.get('/integrations/google/connect');
      const destination = new URL(response.data?.url);

      if (
        destination.protocol !== 'https:' ||
        destination.hostname !== 'accounts.google.com'
      ) {
        throw new Error('Endereço de autorização do Google inválido.');
      }

      window.location.assign(destination.href);
    } catch (e) {
      setError(getErrorMessage(e));
      setBusy('');
    }
  }

  async function testGoogle() {
    setBusy('test');
    setError('');
    setSuccess('');

    try {
      const response = await api.post('/integrations/google/test');

      setSuccess(
        response.data?.message ||
        'E-mail de teste enviado com sucesso!'
      );
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy('');
    }
  }

  async function disconnectGoogle() {
    if (
      !window.confirm(
        'Deseja realmente desconectar o Gmail do ImobGestor?'
      )
    ) {
      return;
    }

    setBusy('disconnect');
    setError('');
    setSuccess('');

    try {
      const response = await api.delete('/integrations/google');

      setSuccess(
        response.data?.message || 'Conta Google desconectada.'
      );

      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="AUTOMAÇÃO E CONEXÕES"
        title="Integrações"
        description="Acesse serviços oficiais e gerencie as conexões do ImobGestor."
        action={
          <button
            className="button button-secondary"
            onClick={load}
            disabled={busy !== ''}
          >
            <RefreshCw size={15} />
            Atualizar status
          </button>
        }
      />

      <ErrorMessage>{error}</ErrorMessage>

      {success && (
        <div className="alert alert-success integration-feedback">
          <CheckCircle2 size={16} />
          {success}
        </div>
      )}

      {/* ====================================
          1. E-MAIL GOOGLE
      ==================================== */}

      <section className="integration-section">
        <div className="integration-section-title">
          <div>
            <span className="eyebrow">COMUNICAÇÃO</span>
            <h2>Serviços conectados</h2>
            <p>Integrações utilizadas no funcionamento do sistema.</p>
          </div>
        </div>

        <div className="integration-grid">
          <article className="integration-card">
            <div className="integration-card-head">
              <div className="integration-icon">
                <Mail size={21} />
              </div>

              {emailConnected ? (
                <StatusBadge type="success">
                  <CheckCircle2 size={12} />
                  Conectado
                </StatusBadge>
              ) : (
                <StatusBadge type="warning">
                  <AlertCircle size={12} />
                  Pendente
                </StatusBadge>
              )}
            </div>

            <h3>E-mail transacional</h3>

            <p>
              Convites de equipe, recuperação de senha, ativação
              do portal e notificações automáticas.
            </p>

            <small>
              <strong>Google Gmail</strong>
              <br />
              Conexão segura OAuth 2.0.
            </small>

            <div className="integration-google">
              {emailConnected ? (
                <>
                  <div className="integration-connected">
                    <CheckCircle2 size={16} />
                    <div>
                      <strong>Conta Google conectada</strong>
                      <span>
                        {data?.emailAddress || 'Conta autorizada'}
                      </span>
                    </div>
                  </div>

                  <button
                    className="button button-primary integration-action"
                    onClick={testGoogle}
                    disabled={busy !== ''}
                  >
                    <Send size={15} />
                    {busy === 'test'
                      ? 'Enviando...'
                      : 'Enviar e-mail de teste'}
                  </button>

                  <button
                    className="button button-secondary integration-action"
                    onClick={disconnectGoogle}
                    disabled={busy !== ''}
                  >
                    <Unplug size={15} />
                    {busy === 'disconnect'
                      ? 'Desconectando...'
                      : 'Desconectar Google'}
                  </button>
                </>
              ) : (
                <>
                  <div className="integration-pending">
                    <AlertCircle size={15} />
                    Sua conta Gmail ainda não está conectada.
                  </div>

                  <button
                    className="button button-primary integration-action"
                    onClick={connectGoogle}
                    disabled={busy !== '' || !data}
                  >
                    <Mail size={15} />
                    {busy === 'connect'
                      ? 'Conectando...'
                      : 'Conectar Google'}
                  </button>
                </>
              )}
            </div>
          </article>

          {/* VERCEL BLOB - PRÓXIMA ETAPA */}

          <article className="integration-card">
            <div className="integration-card-head">
              <div className="integration-icon">
                <Cloud size={21} />
              </div>

              <StatusBadge type="planned">
                Próxima etapa
              </StatusBadge>
            </div>

            <h3>Armazenamento privado</h3>

            <p>
              Armazenamento seguro dos documentos, contratos,
              arquivos dos imóveis e documentos enviados pelos clientes.
            </p>

            <small>
              <strong>Vercel Blob</strong>
              <br />
              Armazenamento privado com acesso controlado.
            </small>

            <div className="integration-pending">
              <Clock3 size={15} />
              Será implementado na próxima fase.
            </div>
          </article>
        </div>
      </section>

      {/* ====================================
          2. ASSINATURA GOV.BR
      ==================================== */}

      <section className="integration-section section-gap">
        <div className="integration-section-title">
          <div>
            <span className="eyebrow">DOCUMENTOS E ASSINATURAS</span>
            <h2>Assinatura eletrônica</h2>
            <p>
              Assine documentos pelo serviço oficial e anexe
              o arquivo assinado ao procedimento.
            </p>
          </div>

          <StatusBadge type="external">
            Fluxo assistido
          </StatusBadge>
        </div>

        <article className="panel govbr-panel">
          <div className="govbr-main">
            <div className="govbr-icon">
              <PenTool size={25} />
            </div>

            <div className="govbr-content">
              <h3>Assinador GOV.BR</h3>
              <p>
                Utilize a plataforma oficial de assinatura eletrônica
                do Governo Federal. Não é necessário configurar uma
                API de assinatura no ImobGestor.
              </p>
            </div>
          </div>

          <div className="govbr-steps">
            <div className="govbr-step">
              <span>1</span>
              <div>
                <strong>Prepare o documento</strong>
                <small>
                  Gere ou baixe o PDF que precisa ser assinado
                  no procedimento.
                </small>
              </div>
            </div>

            <div className="govbr-step">
              <span>2</span>
              <div>
                <strong>Assine no GOV.BR</strong>
                <small>
                  Abra o assinador, entre com sua conta e selecione
                  o documento PDF.
                </small>
              </div>
            </div>

            <div className="govbr-step">
              <span>3</span>
              <div>
                <strong>Baixe o documento assinado</strong>
                <small>
                  Após concluir a assinatura, salve o PDF assinado
                  no seu computador.
                </small>
              </div>
            </div>

            <div className="govbr-step">
              <span>4</span>
              <div>
                <strong>Retorne ao ImobGestor</strong>
                <small>
                  Abra o procedimento correspondente, entre em
                  Documentos e envie o PDF assinado.
                </small>
              </div>
            </div>
          </div>

          <div className="govbr-actions">
            <ExternalButton href="https://assinador.iti.br/">
              <PenTool size={15} />
              Abrir Assinador GOV.BR
            </ExternalButton>

            <Link
              to="/documents"
              className="button button-secondary integration-action"
            >
              <FolderOpen size={15} />
              Ir para documentos
              <ArrowUpRight size={14} />
            </Link>

            <ExternalButton
              href="https://validar.iti.gov.br/"
              secondary
            >
              <FileCheck size={15} />
              Validar assinatura
            </ExternalButton>
          </div>

          <div className="notice-box">
            <strong>Importante:</strong> utilize uma conta GOV.BR
            Prata ou Ouro para assinar. O documento deve ser anexado
            ao procedimento correto para manter seu histórico documental.
            A aceitação da modalidade de assinatura deve ser conferida
            conforme o órgão ou cartório destinatário.
          </div>
        </article>
      </section>

      {/* ====================================
          3. FONTES IMOBILIÁRIAS OFICIAIS
      ==================================== */}

      <section className="integration-section section-gap">
        <div className="integration-section-title">
          <div>
            <span className="eyebrow">CONSULTAS IMOBILIÁRIAS</span>
            <h2>Fontes públicas e cartorárias</h2>
            <p>
              Acesso direto aos sistemas oficiais utilizados
              na regularização de imóveis urbanos e rurais.
            </p>
          </div>

          <StatusBadge type="external">
            Portais oficiais
          </StatusBadge>
        </div>

        <div className="integration-sources-grid">
          {sources.map((source) => {
            const Icon = source.icon;

            return (
              <article
                className="integration-source-card"
                key={source.title}
              >
                <div className="integration-source-head">
                  <div className="integration-icon">
                    <Icon size={20} />
                  </div>
                  <StatusBadge type="external">
                    Acesso externo
                  </StatusBadge>
                </div>

                <span className="integration-source-category">
                  {source.category}
                </span>

                <h3>{source.title}</h3>

                <p>{source.description}</p>

                <small>{source.detail}</small>

                <ExternalButton href={source.url}>
                  Acessar serviço oficial
                </ExternalButton>
              </article>
            );
          })}

          {/* PREFEITURAS */}

          <article className="integration-source-card">
            <div className="integration-source-head">
              <div className="integration-icon">
                <Building2 size={20} />
              </div>

              <StatusBadge type="external">
                Consulta municipal
              </StatusBadge>
            </div>

            <span className="integration-source-category">
              Regularização urbana
            </span>

            <h3>Prefeituras e municípios</h3>

            <p>
              Consulte o cadastro imobiliário, IPTU, zoneamento,
              aprovação de construções, certidões e procedimentos de REURB.
            </p>

            <small>
              O portal depende do município onde está localizado o imóvel.
            </small>

            <a
              className="button button-secondary integration-action"
              href="https://www.gov.br/pt-br/servicos"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Landmark size={15} />
              Localizar serviço público
              <ExternalLink size={14} />
            </a>
          </article>
        </div>

        <div className="notice-box">
          <strong>Sobre estas consultas:</strong> os links levam
          diretamente aos portais oficiais. As consultas ainda não são
          realizadas automaticamente pelo ImobGestor. O usuário acessa
          o serviço externo e registra ou anexa o resultado no procedimento.
          Algumas funcionalidades exigem autenticação, pagamento,
          habilitação ou autorização específica.
        </div>
      </section>

      {/* ====================================
          4. ASAAS - PAGAMENTOS FUTUROS
      ==================================== */}

      <section className="integration-section section-gap">
        <div className="integration-section-title">
          <div>
            <span className="eyebrow">GESTÃO COMERCIAL DO SAAS</span>
            <h2>Pagamentos e assinaturas</h2>
            <p>
              Preparação para cobrança recorrente das licenças
              dos escritórios.
            </p>
          </div>

          <StatusBadge type="planned">
            Planejado
          </StatusBadge>
        </div>

        <article className="integration-card payment-planned-card">
          <div className="integration-card-head">
            <div className="integration-icon">
              <CreditCard size={21} />
            </div>

            <StatusBadge type="planned">
              Não ativado
            </StatusBadge>
          </div>

          <h3>Asaas</h3>

          <p>
            Futuro gerenciamento das cobranças dos planos Inicial,
            Profissional e Empresarial do ImobGestor.
          </p>

          <div className="payment-features">
            <span>PIX</span>
            <span>Boleto</span>
            <span>Cartão de crédito</span>
            <span>Recorrência</span>
            <span>Webhooks</span>
          </div>

          <small>
            A implementação será feita inicialmente em ambiente Sandbox.
            Nenhuma cobrança será gerada nesta etapa.
          </small>

          <ExternalButton
            href="https://docs.asaas.com/docs/visao-geral"
            secondary
          >
            Consultar documentação Asaas
          </ExternalButton>
        </article>
      </section>

      {/* ====================================
          5. ROTINAS AUTOMÁTICAS
      ==================================== */}

      <section className="panel section-gap">
        <div className="panel-heading">
          <div>
            <h2>Rotinas automáticas</h2>
            <p>Execução diária pela Vercel Cron</p>
          </div>

          <Clock3 size={19} className="muted-icon" />
        </div>

        <p className="muted">
          A rotina diária verifica tarefas e compromissos com vencimento
          no dia seguinte, cria notificações internas e envia e-mails
          quando o Gmail estiver conectado.
        </p>

        <div className="notice-box">
          Configure <code>CRON_SECRET</code> nas variáveis de ambiente
          do backend. A rota protegida é{' '}
          <code>/api/v1/cron/daily</code>. Confira se a programação
          está definida no <code>vercel.json</code> e teste a rotina
          antes de depender dos lembretes em produção.
        </div>
      </section>
    </>
  );
}
