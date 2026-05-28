import { Link } from 'react-router-dom';
import { LegalPage, LegalSection } from '../components/legal/LegalPage';

const EFFECTIVE_DATE = 'May 27, 2026';
const CONTACT_EMAIL = 'elliot@patternchess.com';

export function TermsRoute() {
  return (
    <LegalPage title="Terms of Service" effectiveDate={EFFECTIVE_DATE}>
      <p>
        These Terms of Service ("Terms") govern your use of PatternChess (the "Service"), a chess
        training web application operated by EH Solutions LLC ("we", "us", or "our"). By creating an
        account or using the Service, you agree to these Terms. If you do not agree, please do not
        use the Service.
      </p>

      <LegalSection heading="1. The Service">
        <p>
          PatternChess imports your past games from third-party chess platforms (Chess.com and
          Lichess), analyzes them with a chess engine to identify mistakes, and helps you train on
          those positions using a spaced-repetition method. The Service is provided for personal,
          non-commercial use.
        </p>
      </LegalSection>

      <LegalSection heading="2. Accounts">
        <p>
          You sign in using Google. You are responsible for activity that occurs under your account
          and for keeping your sign-in credentials secure. You must be at least 13 years old (or the
          minimum age of digital consent in your jurisdiction) to use the Service.
        </p>
      </LegalSection>

      <LegalSection heading="3. Third-party game data">
        <p>
          When you connect a Chess.com or Lichess username, you confirm that you have the right to
          access and import the associated game history. Your use of those platforms remains subject
          to their own terms of service. We are not affiliated with, endorsed by, or responsible for
          Chess.com or Lichess.
        </p>
      </LegalSection>

      <LegalSection heading="4. Acceptable use">
        <p>
          You agree not to misuse the Service, including by attempting to disrupt it, access it
          through automated means beyond normal use, reverse-engineer it for a competing product, or
          use it to violate any law or the rights of others.
        </p>
      </LegalSection>

      <LegalSection heading="5. Intellectual property">
        <p>
          The Service, including its design, code, and branding, is owned by EH Solutions LLC. Your
          game data and training history remain yours. Chess engine analysis is generated using
          Stockfish, an open-source engine licensed under the GNU GPL.
        </p>
      </LegalSection>

      <LegalSection heading="6. Disclaimer of warranties">
        <p>
          The Service is provided "as is" and "as available", without warranties of any kind, whether
          express or implied. We do not warrant that the Service will be uninterrupted, error-free, or
          that engine analysis or training recommendations will be accurate. PatternChess is a
          training aid, not chess instruction or coaching advice.
        </p>
      </LegalSection>

      <LegalSection heading="7. Limitation of liability">
        <p>
          To the maximum extent permitted by law, EH Solutions LLC will not be liable for any
          indirect, incidental, or consequential damages arising from your use of the Service. The
          Service is offered at no cost, and our total liability to you is limited accordingly.
        </p>
      </LegalSection>

      <LegalSection heading="8. Termination">
        <p>
          You may stop using the Service and delete your account at any time. We may suspend or
          terminate access if you violate these Terms or if we discontinue the Service.
        </p>
      </LegalSection>

      <LegalSection heading="9. Changes to these Terms">
        <p>
          We may update these Terms from time to time. If we make material changes, we will update the
          effective date above. Continued use of the Service after changes take effect constitutes
          acceptance of the updated Terms.
        </p>
      </LegalSection>

      <LegalSection heading="10. Contact">
        <p>
          Questions about these Terms? Email us at{' '}
          <a className="underline hover:text-gold-dark" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
        <p className="text-sm text-[#1A1A1A]/60">
          See also our{' '}
          <Link className="underline hover:text-gold-dark" to="/privacy">
            Privacy Policy
          </Link>
          .
        </p>
      </LegalSection>

      <p className="text-sm text-[#1A1A1A]/60">
        This document is a good-faith plain-language summary provided for transparency and is not
        legal advice.
      </p>
    </LegalPage>
  );
}
