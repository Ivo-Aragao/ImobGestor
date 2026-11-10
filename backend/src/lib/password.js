import bcrypt from 'bcryptjs';

export const hashPassword = (password) => bcrypt.hash(password, 12);
export const verifyPassword = (password, hash) => bcrypt.compare(password, hash);

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10) {
    return 'A senha deve ter pelo menos 10 caracteres.';
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Use letras maiúsculas, minúsculas e pelo menos um número.';
  }
  return null;
}
