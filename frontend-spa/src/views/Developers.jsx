import AuthHeader from '../components/AuthHeader';
import AuthFooter from '../components/AuthFooter';
import Beams from '../components/Beams';
import meetTheDevelopers from '../assets/meet-the-developers.png';

export default function Developers() {
  return (
    <div className="auth-page-shell">
      <AuthHeader />

      <main className="auth-hero">
        <div className="dev-hero-beams" aria-hidden="true">
          <Beams beamColor="#1F57E4" backgroundColor="#1F57E4" lightColor="#1F57E4" />
        </div>
        <div className="auth-hero-inner">
          <p className="auth-hero-eyebrow">Barangay VMS</p>
          <h1 className="auth-hero-title">Meet the Developers</h1>
          <p className="auth-hero-subtitle">
            This system was built as a capstone project by a small, dedicated team
            committed to giving barangays a better way to manage their vehicle fleet.
          </p>

          <div className="dev-team-banner">
            <img src={meetTheDevelopers} alt="Meet the Developers: Precious Dignos, John Paul Orozco, Justine Mae Belia, Riel Jake Engana" />
          </div>
        </div>
      </main>

      <AuthFooter />
    </div>
  );
}
