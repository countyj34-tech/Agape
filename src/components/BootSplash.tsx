import { useEffect, useState } from 'react';

const LOGO_SRC = '/splash-logo.png';
const MARK_SRC = '/splash-mark.svg';

export function BootSplash() {
  const [progress, setProgress] = useState(8);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 92) return current;
        return Math.min(92, current + Math.floor(Math.random() * 6) + 2);
      });
    }, 180);

    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="boot-splash" role="status" aria-live="polite" aria-label="Loading Mthunzi POS">
      <div className="boot-splash-bg" aria-hidden="true">
        <div className="boot-splash-orb boot-splash-orb-a" />
        <div className="boot-splash-orb boot-splash-orb-b" />
        <div className="boot-splash-grid" />
        <span className="boot-splash-spark s1" />
        <span className="boot-splash-spark s2" />
        <span className="boot-splash-spark s3" />
        <span className="boot-splash-spark s4" />
      </div>

      <div className="boot-splash-stage">
        <div className="boot-splash-mark">
          <div className="boot-splash-halo" />
          <div className="boot-splash-ring" />
          <div className="boot-splash-tile">
            {logoFailed ? (
              <img src={MARK_SRC} alt="Mthunzi" className="boot-splash-logo boot-splash-logo-svg" />
            ) : (
              <img
                src={LOGO_SRC}
                alt="Mthunzi"
                className="boot-splash-logo"
                onError={() => setLogoFailed(true)}
              />
            )}
          </div>
        </div>

        <div className="boot-splash-copy">
          <p className="boot-splash-brand">Mthunzi POS</p>
          <p className="boot-splash-tag">Smart retail. Instant checkout.</p>
        </div>

        <div className="boot-splash-meter">
          <div className="boot-splash-bar">
            <div className="boot-splash-fill" style={{ width: `${progress}%` }} />
            <div className="boot-splash-sheen" />
          </div>
          <p className="boot-splash-status">Initializing…</p>
        </div>
      </div>
    </div>
  );
}
