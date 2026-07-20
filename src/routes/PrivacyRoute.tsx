import { Link } from 'react-router-dom';
import { LegalPage, LegalSection } from '../components/legal/LegalPage';
import { useHead } from '../seo/useHead';

const EFFECTIVE_DATE = 'May 27, 2026';
const CONTACT_EMAIL = 'elliot@patternchess.com';

export function PrivacyRoute() {
  useHead({
    title: 'Privacy Policy',
    description: 'What data PatternChess collects, why, and how it is handled.',
    canonical: '/privacy',
  });
  return (
    <LegalPage title="Privacy Policy" effectiveDate={EFFECTIVE_DATE}>
      <p>
        This Privacy Policy explains what data PatternChess (operated by EH Solutions LLC) collects,
        why, and how it is handled. We aim to collect only what the Service needs to work.
      </p>

      <LegalSection heading="1. Information we collect">
        <p>We collect the following, all tied to your account:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Account details from Google sign-in:</strong> your email address, display name,
            and profile photo, provided through Google OAuth when you log in.
          </li>
          <li>
            <strong>Chess platform usernames:</strong> the Chess.com and/or Lichess usernames you
            choose to connect.
          </li>
          <li>
            <strong>Game and training data:</strong> games imported from those platforms, engine
            analysis of those games, detected mistakes ("blunders"), your training sessions and
            results, spaced-repetition progress, streaks, annotations you write, and your
            preferences (time controls, rated-only, timezone).
          </li>
        </ul>
        <p>
          We do not collect payment information, and we do not run advertising or third-party
          tracking/analytics cookies. Chess engine analysis (Stockfish) runs locally in your browser.
        </p>
      </LegalSection>

      <LegalSection heading="2. How we use your information">
        <p>We use your information solely to operate the Service: to</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>authenticate you and maintain your account;</li>
          <li>import and analyze your games to identify trainable mistakes;</li>
          <li>track your training progress and spaced-repetition schedule;</li>
          <li>and respond to support requests.</li>
        </ul>
        <p>We do not sell your personal information.</p>
      </LegalSection>

      <LegalSection heading="3. Third-party services">
        <p>The Service relies on the following providers:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Supabase</strong> — hosts our database and authentication. Your account and game
            data are stored there.
          </li>
          <li>
            <strong>Google</strong> — provides sign-in (OAuth). We receive basic profile details as
            described above.
          </li>
          <li>
            <strong>Chess.com and Lichess</strong> — your browser fetches your public game history
            from their APIs when you sync.
          </li>
          <li>
            <strong>Lichess Opening Explorer</strong> — queried to show opening reference data.
          </li>
        </ul>
        <p>Each provider processes data under its own privacy policy.</p>
      </LegalSection>

      <LegalSection heading="4. Data retention">
        <p>
          We retain your data for as long as your account is active. If you delete your account or
          ask us to remove your data, we delete your profile, imported games, blunders, and training
          history.
        </p>
      </LegalSection>

      <LegalSection heading="5. Your rights">
        <p>
          You can access, correct, export, or delete your personal data. Depending on where you live
          (for example, under GDPR or CCPA), you may have additional rights regarding your data. To
          exercise any of these, email us at{' '}
          <a className="underline hover:text-gold-dark" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection heading="6. Security">
        <p>
          We rely on Supabase's infrastructure and row-level security so that each user can only
          access their own data. No system is perfectly secure, but we take reasonable measures to
          protect your information.
        </p>
      </LegalSection>

      <LegalSection heading="7. Children">
        <p>
          The Service is not directed to children under 13, and we do not knowingly collect data from
          them.
        </p>
      </LegalSection>

      <LegalSection heading="8. Changes to this Policy">
        <p>
          We may update this Policy from time to time. Material changes will be reflected in the
          effective date above.
        </p>
      </LegalSection>

      <LegalSection heading="9. Contact">
        <p>
          Questions or requests about your privacy? Email{' '}
          <a className="underline hover:text-gold-dark" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
        <p className="text-sm text-text-primary/60">
          See also our{' '}
          <Link className="underline hover:text-gold-dark" to="/terms">
            Terms of Service
          </Link>
          .
        </p>
      </LegalSection>

      <p className="text-sm text-text-primary/60">
        This document is a good-faith plain-language summary provided for transparency and is not
        legal advice.
      </p>
    </LegalPage>
  );
}
