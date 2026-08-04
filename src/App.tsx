/**
 * The app is a single interface now. Two were trialled side by side behind
 * `?version=`; version B won and version A is gone, so this file only holds the
 * lazy boundary that keeps the schedule bundle out of the initial load.
 */
import { lazy, Suspense } from 'react';
import './App.css';

const ScheduleApp = lazy(() => import('./ScheduleApp'));

export default function App() {
  return (
    <Suspense fallback={<AppLoading />}>
      <ScheduleApp />
    </Suspense>
  );
}

function AppLoading() {
  return (
    <div className="app-loading" role="status">
      Öppnar schemat…
    </div>
  );
}
