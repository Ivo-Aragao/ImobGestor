import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

export function getErrorMessage(error) {
  return error?.response?.data?.error || error?.response?.data?.message || error.message || 'Ocorreu um erro inesperado.';
}
