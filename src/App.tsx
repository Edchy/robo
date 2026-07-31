import { lazy, Suspense } from 'react';
import './App.css';

type Version = 'a' | 'b';

const OriginalApp = lazy(() => import('./versions/original/App'));
const ReimaginedApp = lazy(() => import('./versions/reimagined/App'));

const currentVersion = (): Version => {
  const version = new URLSearchParams(window.location.search).get('version');
  return version === 'a' ? 'a' : 'b';
};

const versionHref = (version: Version) => {
  const url = new URL(window.location.href);
  url.search = `?version=${version}`;
  url.hash = '';
  return `${url.pathname}${url.search}`;
};

export default function App() {
  const version = currentVersion();
  const ScheduleApp = version === 'a' ? OriginalApp : ReimaginedApp;

  return (
    <div className="version-frame">
      <header className="version-toolbar">
        <p>
          Två sätt att visa samma schema testas just nu. Byt gärna och säg
          vilken som känns enklast.
        </p>
        <nav aria-label="Välj schemaversion">
          <a
            className={version === 'a' ? 'is-current' : undefined}
            href={versionHref('a')}
            aria-current={version === 'a' ? 'page' : undefined}
          >
            Version A
          </a>
          <a
            className={version === 'b' ? 'is-current' : undefined}
            href={versionHref('b')}
            aria-current={version === 'b' ? 'page' : undefined}
          >
            Version B
          </a>
        </nav>
      </header>
      <Suspense fallback={<VersionLoading />}>
        <ScheduleApp />
      </Suspense>
    </div>
  );
}

function VersionLoading() {
  return (
    <div className="version-loading" role="status">
      Öppnar versionen…
    </div>
  );
}
