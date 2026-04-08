import { useState } from 'react';
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';

interface Props {
  loginWithKeyword: (keyword: string) => boolean;
  loginWithGoogle: (cr: CredentialResponse) => boolean;
}

export default function LoginPage({ loginWithKeyword, loginWithGoogle }: Props) {
  const [keyword, setKeyword] = useState('');
  const [showKeyword, setShowKeyword] = useState(false);
  const [error, setError] = useState('');

  function handleKeywordSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = loginWithKeyword(keyword.trim());
    if (!ok) {
      setError('Incorrect keyword. Try Google sign-in if you don\'t have one.');
      setKeyword('');
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Logo */}
        <div style={styles.logo}>ALPIC</div>
        <h1 style={styles.title}>Outreach Dashboard</h1>
        <p style={styles.subtitle}>Sign in to access the pipeline</p>

        {/* Keyword form */}
        <form onSubmit={handleKeywordSubmit} style={styles.form}>
          <label style={styles.label}>Access keyword</label>
          <div style={styles.inputWrap}>
            <input
              type={showKeyword ? 'text' : 'password'}
              value={keyword}
              onChange={e => { setKeyword(e.target.value); setError(''); }}
              placeholder="Enter your keyword"
              style={styles.input}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowKeyword(v => !v)}
              style={styles.eyeBtn}
              tabIndex={-1}
            >
              {showKeyword ? '🙈' : '👁'}
            </button>
          </div>
          {error && <p style={styles.error}>{error}</p>}
          <button type="submit" style={styles.submitBtn} disabled={!keyword}>
            Sign in
          </button>
        </form>

        {/* Divider */}
        <div style={styles.divider}>
          <div style={styles.dividerLine} />
          <span style={styles.dividerText}>or</span>
          <div style={styles.dividerLine} />
        </div>

        {/* Google OAuth */}
        <p style={styles.googleLabel}>New to the team? Sign up with Google</p>
        <div style={styles.googleWrap}>
          <GoogleLogin
            onSuccess={(cr: CredentialResponse) => {
              const ok = loginWithGoogle(cr);
              if (!ok) setError('Access restricted to @alpic.ai accounts.');
            }}
            onError={() => setError('Google sign-in failed. Please try again.')}
            theme="filled_black"
            shape="rectangular"
            size="large"
            text="continue_with"
            width="320"
          />
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    background: 'var(--bg)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
  },
  card: {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: '16px',
    padding: '40px',
    width: '100%',
    maxWidth: '380px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
  },
  logo: {
    fontFamily: "'DM Mono', monospace",
    fontWeight: 500,
    fontSize: '12px',
    letterSpacing: '0.15em',
    background: 'var(--accent)',
    color: 'white',
    padding: '4px 10px',
    borderRadius: '4px',
    marginBottom: '8px',
  },
  title: {
    fontSize: '20px',
    fontWeight: 700,
    color: 'var(--text)',
    textAlign: 'center',
    letterSpacing: '-0.02em',
  },
  subtitle: {
    fontSize: '13px',
    color: 'var(--text-secondary)',
    textAlign: 'center',
    marginBottom: '16px',
  },
  form: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  label: {
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  inputWrap: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  input: {
    width: '100%',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    padding: '11px 40px 11px 14px',
    color: 'var(--text)',
    fontSize: '14px',
    fontFamily: "'DM Sans', sans-serif",
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  eyeBtn: {
    position: 'absolute',
    right: '12px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '16px',
    padding: '0',
    lineHeight: 1,
  },
  error: {
    fontSize: '12px',
    color: 'var(--red)',
    margin: '0',
  },
  submitBtn: {
    background: 'var(--accent)',
    border: 'none',
    borderRadius: '8px',
    color: 'white',
    padding: '12px',
    fontSize: '14px',
    fontWeight: 600,
    fontFamily: "'DM Sans', sans-serif",
    cursor: 'pointer',
    transition: 'opacity 0.15s',
    marginTop: '4px',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    width: '100%',
    margin: '8px 0',
  },
  dividerLine: {
    flex: 1,
    height: '1px',
    background: 'var(--border)',
  },
  dividerText: {
    fontSize: '12px',
    color: 'var(--text-secondary)',
  },
  googleLabel: {
    fontSize: '12px',
    color: 'var(--text-secondary)',
    textAlign: 'center',
  },
  googleWrap: {
    display: 'flex',
    justifyContent: 'center',
    width: '100%',
    marginTop: '4px',
  },
};
