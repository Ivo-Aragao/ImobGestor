
import axios from 'axios';

const baseURL = (
  import.meta.env.VITE_API_URL || '/api/v1'
).replace(/\/+$/, '');

export const api = axios.create({
  baseURL,
  withCredentials: true,
  timeout: 60000,
});

// Mantém o envio JSON normal e permite que o navegador
// defina o Content-Type e o boundary do FormData.
api.interceptors.request.use((config) => {
  if (
    typeof FormData !== 'undefined' &&
    config.data instanceof FormData
  ) {
    if (typeof config.headers?.delete === 'function') {
      config.headers.delete('Content-Type');
    } else if (config.headers) {
      delete config.headers['Content-Type'];
      delete config.headers['content-type'];
    }
  }

  return config;
});

export function getErrorMessage(error) {
  return (
    error?.response?.data?.error ||
    error?.response?.data?.message ||
    error?.message ||
    'Ocorreu um erro inesperado.'
  );
}
