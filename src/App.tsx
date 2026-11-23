import { useEffect } from 'react';
import { MapView } from './map/MapView';
import { useApp } from './state/store';
import { initGeolocation } from './state/controller';
import { SearchPanel } from './ui/SearchPanel';
import { PlanSheet } from './ui/PlanSheet';
import { NavHud } from './ui/NavHud';
import { Arrival, Intro, Toast } from './ui/Screens';
import { StoryViewer } from './ui/Story';
import { TasteScreen } from './ui/Taste';

export function App() {
  const phase = useApp((s) => s.phase);
  const screen = useApp((s) => s.screen);
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
      {screen?.kind === 'story' && <StoryViewer key={screen.spotId} spotId={screen.spotId} />}
      {screen?.kind === 'taste' && <TasteScreen />}
      <Toast />
    </div>
  );
}
