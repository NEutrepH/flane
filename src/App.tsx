import { useEffect } from 'react';
import { MapView } from './map/MapView';
import { useApp } from './state/store';
import { initGeolocation } from './state/controller';
import { SearchPanel } from './ui/SearchPanel';
import { PlanSheet } from './ui/PlanSheet';
import { NavHud } from './ui/NavHud';
import { Arrival, Intro, Toast } from './ui/Screens';

export function App() {
  const phase = useApp((s) => s.phase);
  useEffect(() => {
    initGeolocation();
  }, []);
  return (
    <div className={`app app--${phase}`}>
      <MapView />
      <div className="grain" aria-hidden />
      {(phase === 'explore' || phase === 'plan') && <SearchPanel />}
      {phase === 'explore' && <Intro />}
      {phase === 'plan' && <PlanSheet />}
      {phase === 'nav' && <NavHud />}
      {phase === 'arrived' && <Arrival />}
      <Toast />
    </div>
  );
}
