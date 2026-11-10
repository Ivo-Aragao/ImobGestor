import { useState } from 'react';
import { api, getErrorMessage } from '../services/api';
import { ErrorMessage } from '../components/Feedback';
import { Building2, LockKeyhole, Mail, UserRound } from 'lucide-react';

export default function AuthPage({ onSuccess }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ tenantName: '', name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [memberships, setMemberships] = useState([]);
  const [tenantId, setTenantId] = useState('');
  function update(key, value) { setForm(current => ({ ...current, [key]: value })); if (key === 'email') setMemberships([]); }
  async function submit(event) {
    event.preventDefault(); setError(''); setNotice(''); setBusy(true);
    try {
      if (mode === 'forgot') {
        const { data } = await api.post('/auth/forgot-password', { email: form.email });
        setNotice(data.message + (data.developmentResetUrl ? ` Link local: ${data.developmentResetUrl}` : ''));
        return;
      }
      const payload = mode === 'login' ? { email: form.email, password: form.password, ...(tenantId ? { tenantId } : {}) } : form;
      await api.post(mode === 'register' ? '/auth/register' : '/auth/login', payload);
      await onSuccess();
    } catch (err) {
      if (err.response?.status === 409 && Array.isArray(err.response.data?.memberships)) {
        setMemberships(err.response.data.memberships);
        setTenantId(err.response.data.memberships[0]?.tenantId || '');
        setError('Sua conta pertence a mais de um escritório. Selecione onde deseja entrar.');
      } else setError(getErrorMessage(err));
    } finally { setBusy(false); }
  }
  function changeMode(next) { setMode(next); setError(''); setNotice(''); setMemberships([]); setTenantId(''); }
  return (
    <div className="auth-screen">
      <div className="auth-decoration"><div className="auth-decoration-content"><div className="brand-lockup"><div className="brand-mark brand-mark-light">IG</div><strong>ImobGestor</strong></div><div className="auth-pitch"><span className="eyebrow">GESTÃO INTELIGENTE DE IMÓVEIS</span><h1>Seu escritório organizado. Seus clientes bem informados.</h1><p>Centralize clientes, imóveis, documentos e procedimentos em um só lugar.</p></div><div className="auth-footnote">Plataforma de gestão imobiliária</div></div></div>
      <div className="auth-form-side"><form className="auth-card" onSubmit={submit}><div className="auth-mobile-brand"><div className="brand-mark">IG</div><strong>ImobGestor</strong></div><span className="eyebrow">BEM-VINDO</span><h2>{mode === 'login' ? 'Acesse sua conta' : mode === 'register' ? 'Cadastre seu escritório' : 'Recuperar senha'}</h2><p className="muted">{mode === 'login' ? 'Entre para continuar gerenciando seus serviços.' : mode === 'register' ? 'Crie o ambiente inicial do seu escritório.' : 'Informe seu e-mail para receber um link de redefinição.'}</p><ErrorMessage>{error}</ErrorMessage>{notice && <div className="notice-box">{notice}</div>}
        {mode === 'register' && <><label>Nome do escritório<div className="input-wrap"><Building2 size={17}/><input value={form.tenantName} onChange={e => update('tenantName', e.target.value)} required placeholder="Ex.: Escritório Modelo" /></div></label><label>Seu nome<div className="input-wrap"><UserRound size={17}/><input value={form.name} onChange={e => update('name', e.target.value)} required placeholder="Nome completo" /></div></label></>}
        <label>E-mail<div className="input-wrap"><Mail size={17}/><input type="email" autoComplete="email" value={form.email} onChange={e => update('email', e.target.value)} required placeholder="voce@escritorio.com" /></div></label>
        {mode !== 'forgot' && <label>Senha<div className="input-wrap"><LockKeyhole size={17}/><input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={form.password} onChange={e => update('password', e.target.value)} required placeholder="Mínimo de 10 caracteres" /></div></label>}
        {mode === 'login' && memberships.length > 0 && <label>Escolha o escritório<select value={tenantId} onChange={e => setTenantId(e.target.value)} required>{memberships.map(m => <option key={m.tenantId} value={m.tenantId}>{m.tenantName} — {m.role}</option>)}</select></label>}
        {mode === 'register' && <small className="form-hint">Em produção, o cadastro público deverá ser liberado pelo administrador da plataforma. Você também poderá entrar por convite.</small>}
        <button className="button button-primary button-full" disabled={busy}>{busy ? 'Aguarde...' : mode === 'login' ? 'Entrar no sistema' : mode === 'register' ? 'Criar escritório' : 'Enviar instruções'}</button>
        {mode === 'login' && <p className="auth-switch"><button type="button" onClick={() => changeMode('forgot')}>Esqueci minha senha</button></p>}
        <p className="auth-switch">{mode === 'login' ? 'Ainda não tem ambiente?' : 'Já possui uma conta?'} <button type="button" onClick={() => changeMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Criar escritório' : 'Fazer login'}</button></p>
      </form></div>
    </div>
  );
}
