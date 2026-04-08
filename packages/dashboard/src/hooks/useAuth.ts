import { useState, useCallback } from 'react';
import type { CredentialResponse } from '@react-oauth/google';

const AUTH_KEY = 'alpic_auth_v1';
const KEYWORD = import.meta.env.VITE_ACCESS_KEYWORD;

export interface AuthUser {
  name: string;
  email: string;
  picture?: string;
  method: 'keyword' | 'google';
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const stored = localStorage.getItem(AUTH_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const loginWithKeyword = useCallback((keyword: string): boolean => {
    if (!KEYWORD || keyword !== KEYWORD) return false;
    const u: AuthUser = { name: 'Team Member', email: '', method: 'keyword' };
    localStorage.setItem(AUTH_KEY, JSON.stringify(u));
    setUser(u);
    return true;
  }, []);

  const loginWithGoogle = useCallback((credentialResponse: CredentialResponse): boolean => {
    if (!credentialResponse.credential) return false;
    const [, payloadB64] = credentialResponse.credential.split('.');
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.email?.endsWith('@alpic.ai')) return false;
    const u: AuthUser = {
      name: payload.name,
      email: payload.email,
      picture: payload.picture,
      method: 'google',
    };
    localStorage.setItem(AUTH_KEY, JSON.stringify(u));
    setUser(u);
    return true;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_KEY);
    setUser(null);
  }, []);

  return { user, loginWithKeyword, loginWithGoogle, logout };
}
