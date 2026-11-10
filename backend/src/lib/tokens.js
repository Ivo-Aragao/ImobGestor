import jwt from 'jsonwebtoken';

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) {
  throw new Error('JWT_SECRET ausente ou muito curto. Configure pelo menos 32 caracteres.');
}

export function signSession(payload) {
  return jwt.sign(payload, secret, { expiresIn: '8h', issuer: 'imobgestor' });
}

export function verifySession(token) {
  return jwt.verify(token, secret, { issuer: 'imobgestor' });
}
