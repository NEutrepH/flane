/** Crédits obligatoires des données (licences OpenStreetMap / OpenMapTiles / Wikipédia). */
export function Attribution() {
  return (
    <p className="attrib">
      <a href="https://openfreemap.org" target="_blank" rel="noreferrer">
        OpenFreeMap
      </a>{' '}
      ·{' '}
      <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">
        © OpenMapTiles
      </a>{' '}
      ·{' '}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        © contributeurs OpenStreetMap
      </a>{' '}
      · Wikipédia · <span className="attrib__build">v. {__BUILD__}</span>
    </p>
  );
}
