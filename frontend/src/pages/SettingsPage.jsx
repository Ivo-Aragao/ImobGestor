
import { useEffect, useState } from 'react';
import { Building2, Save, User } from 'lucide-react';
import { api, getErrorMessage } from '../services/api';
import PageHeader from '../components/PageHeader';
import { ErrorMessage, SuccessMessage } from '../components/Feedback';

export default function SettingsPage({ onProfileUpdated }) {
  const [form, setForm] = useState({
    name: '',
    legalName: '',
    document: '',
    email: '',
    phone: '',
  });

  const [profile, setProfile] = useState({
    name: '',
    email: '',
  });

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');

  const [busy, setBusy] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);

  useEffect(() => {
    api.get('/settings/tenant')
      .then(({ data }) => {
        setForm({
          name: data.name || '',
          legalName: data.legalName || '',
          document: data.document || '',
          email: data.email || '',
          phone: data.phone || '',
        });
      })
      .catch((e) => setError(getErrorMessage(e)));

    api.get('/settings/profile')
      .then(({ data }) => {
        setProfile({
          name: data.name || '',
          email: data.email || '',
        });
      })
      .catch((e) => setProfileError(getErrorMessage(e)));
  }, []);

  async function submitProfile(e) {
    e.preventDefault();

    setProfileBusy(true);
    setProfileError('');
    setProfileSuccess('');

    try {
      const { data } = await api.patch('/settings/profile', {
        name: profile.name,
      });

      setProfile({
        name: data.name,
        email: data.email,
      });

      // Atualiza os dados da sessão e o nome da barra lateral.
      await onProfileUpdated?.();

      setProfileSuccess('Nome atualizado com sucesso.');
    } catch (e) {
      setProfileError(getErrorMessage(e));
    } finally {
      setProfileBusy(false);
    }
  }

  async function submit(e) {
    e.preventDefault();

    setBusy(true);
    setError('');
    setSuccess('');

    try {
      await api.patch('/settings/tenant', form);
      setSuccess('Dados do escritório atualizados.');
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="CONFIGURAÇÕES"
        title="Dados do escritório"
        description="Gerencie seu perfil e os dados institucionais do escritório."
      />

      {/* PERFIL DO USUÁRIO */}
      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>Meu perfil</h2>
            <p>Altere o nome que aparece na barra lateral do sistema.</p>
          </div>
          <User size={20} className="muted-icon" />
        </div>

        <ErrorMessage>{profileError}</ErrorMessage>
        <SuccessMessage>{profileSuccess}</SuccessMessage>

        <form className="form-grid" onSubmit={submitProfile}>
          <label>
            Nome de exibição
            <input
              required
              minLength={2}
              maxLength={120}
              value={profile.name}
              onChange={(e) =>
                setProfile({ ...profile, name: e.target.value })
              }
              placeholder="Digite seu nome completo"
            />
          </label>

          <label>
            E-mail da conta
            <input
              type="email"
              value={profile.email}
              disabled
              readOnly
            />
          </label>

          <div className="form-actions full-field">
            <button
              type="submit"
              className="button button-primary"
              disabled={profileBusy}
            >
              <Save size={15} />
              {profileBusy ? 'Salvando...' : 'Salvar meu nome'}
            </button>
          </div>
        </form>
      </section>

      {/* DADOS DO ESCRITÓRIO */}
      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>Identificação do escritório</h2>
            <p>As alterações ficam restritas ao ambiente atual.</p>
          </div>
          <Building2 size={20} className="muted-icon" />
        </div>

        <ErrorMessage>{error}</ErrorMessage>
        <SuccessMessage>{success}</SuccessMessage>

        <form className="form-grid" onSubmit={submit}>
          <label>
            Nome de exibição
            <input
              required
              value={form.name}
              onChange={(e) =>
                setForm({ ...form, name: e.target.value })
              }
            />
          </label>

          <label>
            Razão social
            <input
              value={form.legalName}
              onChange={(e) =>
                setForm({ ...form, legalName: e.target.value })
              }
            />
          </label>

          <label>
            CPF/CNPJ
            <input
              value={form.document}
              onChange={(e) =>
                setForm({ ...form, document: e.target.value })
              }
            />
          </label>

          <label>
            E-mail institucional
            <input
              type="email"
              value={form.email}
              onChange={(e) =>
                setForm({ ...form, email: e.target.value })
              }
            />
          </label>

          <label>
            Telefone
            <input
              value={form.phone}
              onChange={(e) =>
                setForm({ ...form, phone: e.target.value })
              }
            />
          </label>

          <div className="form-actions full-field">
            <button
              type="submit"
              className="button button-primary"
              disabled={busy}
            >
              <Save size={15} />
              {busy ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
