import { useState } from "react";
import { signInWithProvider } from "@/auth/auth";
import { oauthProviders } from "@/auth/providers";
import { t } from "@/i18n";
import styles from "./SignInPage.module.scss";

export function SignInPage() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function handleSignIn(providerId: (typeof oauthProviders)[number]["id"]) {
    setPending(true);
    setError(false);
    try {
      await signInWithProvider(providerId);
      // On success the browser redirects to the OAuth provider, so nothing
      // further runs here.
    } catch {
      setError(true);
      setPending(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <h1 className={styles.title}>{t.auth.signInTitle}</h1>
        <p className={styles.tagline}>{t.app.tagline}</p>

        {oauthProviders.map((provider) => (
          <button
            key={provider.id}
            type="button"
            className="btn btn--primary"
            disabled={pending}
            onClick={() => handleSignIn(provider.id)}
          >
            {pending ? t.auth.signingIn : t.auth[provider.labelKey]}
          </button>
        ))}

        {error && <p className={styles.error}>{t.auth.signInError}</p>}
      </section>
    </main>
  );
}
