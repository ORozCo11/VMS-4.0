import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, Marker, Polygon, Popup, TileLayer, Tooltip, useMap, ZoomControl } from 'react-leaflet';
import { toPng } from 'html-to-image';
import { PAKNAAN_BOUNDS, PAKNAAN_CENTER, PAKNAAN_HUBS, PAKNAAN_POLYGON, HUBS_STORAGE_KEY } from '../data/paknaanLocationDensity';

const CARTO_DARK_TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const CARTO_ATTRIBUTION = '&copy; OpenStreetMap contributors &copy; CARTO';

function createHubIcon(label, isCustom = false) {
  const borderColor = isCustom ? '#FF6B9D' : '#22C55E';
  const bgColor = isCustom ? '#7C1D4F' : '#052E16';
  const innerColor = isCustom ? '#E84C89' : '#14532D';

  return L.divIcon({
    className: 'location-density-hub-icon',
    html: `
      <svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42" aria-hidden="true">
        <circle cx="21" cy="21" r="20" fill="${bgColor}" stroke="${borderColor}" stroke-width="2"/>
        <circle cx="21" cy="21" r="15" fill="${innerColor}" stroke="#86EFAC" stroke-width="1"/>
        <path d="M12 24.5 21 17l9 7.5" fill="none" stroke="#DCFCE7" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M15.5 23.5v8h11v-8" fill="none" stroke="#DCFCE7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="21" y="15" text-anchor="middle" fill="#BBF7D0" font-size="8" font-family="Arial, sans-serif" font-weight="800">${label}</text>
      </svg>
    `,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    popupAnchor: [0, -21],
  });
}

function createVehicleDotIcon(count) {
  return L.divIcon({
    className: 'location-density-vehicle-dot-icon',
    html: `
      <span class="location-density-vehicle-dot">
        ${count > 1 ? `<span class="location-density-vehicle-count">${count}</span>` : ''}
      </span>
    `,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10],
  });
}

function isValidCoordinate(value) {
  return Number.isFinite(value);
}

function normalizeLocation(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// Vehicles whose recorded location does not match any known hub are still
// pinned here so every vehicle is accounted for on the map.
const FALLBACK_HUB = {
  id: 'paknaan-area-unassigned',
  name: 'Paknaan Area (Unassigned)',
  address: 'Within Paknaan barangay boundary',
  lat: PAKNAAN_CENTER.lat,
  lng: PAKNAAN_CENTER.lng,
  label: 'PK',
  matchNames: [],
};

function findHubForVehicle(vehicle) {
  const location = normalizeLocation(vehicle.current_location);

  if (!location) {
    return null;
  }

  // 1. Exact match against any hub alias.
  const exact = PAKNAAN_HUBS.find((hub) => (
    hub.matchNames.some((name) => location === normalizeLocation(name))
  ));

  if (exact) {
    return exact;
  }

  // 2. Loose contains-match so minor wording differences still land on a hub.
  return PAKNAAN_HUBS.find((hub) => (
    hub.matchNames.some((name) => {
      const normalized = normalizeLocation(name);
      return location.includes(normalized) || normalized.includes(location);
    })
  )) ?? null;
}

function groupVehiclesByHub(vehicles) {
  const groups = new Map();

  vehicles.forEach((vehicle) => {
    const matchedHub = findHubForVehicle(vehicle);
    const hub = (matchedHub && isValidCoordinate(matchedHub.lat) && isValidCoordinate(matchedHub.lng))
      ? matchedHub
      : FALLBACK_HUB;

    const currentGroup = groups.get(hub.id) ?? { hub, vehicles: [] };
    currentGroup.vehicles.push(vehicle);
    groups.set(hub.id, currentGroup);
  });

  return Array.from(groups.values());
}

function MapClickHandler({ addMode, onPickLocation }) {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();

    if (addMode) {
      map.dragging.disable();
      container.style.cursor = 'crosshair';
    } else {
      map.dragging.enable();
      container.style.cursor = '';
    }

    const handleClick = (e) => {
      if (!addMode) return;
      onPickLocation({ lat: e.latlng.lat, lng: e.latlng.lng });
    };

    map.on('click', handleClick);

    return () => {
      map.off('click', handleClick);
      container.style.cursor = '';
    };
  }, [map, addMode, onPickLocation]);

  return null;
}

// Captures the live Leaflet map (tiles + overlays) to a PNG and triggers a download.
async function captureMapToPng(mapEl) {
  if (!mapEl) {
    throw new Error('Map element not found');
  }

  const dataUrl = await toPng(mapEl, {
    cacheBust: true,
    pixelRatio: 2,
    // Skip Leaflet's interactive controls so the export is a clean map snapshot.
    filter: (node) => !(node.classList && (
      node.classList.contains('leaflet-control-zoom')
      || node.classList.contains('leaflet-control-attribution')
    )),
  });

  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `vehicle-map-${new Date().toISOString().split('T')[0]}.png`;
  link.click();
}

function FitBoundsToPolygon() {
  const map = useMap();

  useEffect(() => {
    const bounds = L.latLngBounds(PAKNAAN_POLYGON);
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 });
  }, [map]);

  return null;
}

function LocationDensityMap({ vehicles = [], onHubsChange = null }) {
  const [customHubs, setCustomHubs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(HUBS_STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  });
  const [addMode, setAddMode] = useState(false);
  const [pendingLatLng, setPendingLatLng] = useState(null);
  const [hubNameDraft, setHubNameDraft] = useState('');
  const [capturing, setCapturing] = useState(false);
  const mapShellRef = useRef(null);
  const nameInputRef = useRef(null);

  // When the naming modal opens, focus the input.
  useEffect(() => {
    if (pendingLatLng && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [pendingLatLng]);

  const handlePickLocation = useCallback((latLng) => {
    setAddMode(false);
    setHubNameDraft('');
    setPendingLatLng(latLng);
  }, []);

  const cancelNaming = useCallback(() => {
    setPendingLatLng(null);
    setHubNameDraft('');
  }, []);

  const confirmNaming = useCallback(() => {
    const name = hubNameDraft.trim();
    if (!name || !pendingLatLng) {
      return;
    }

    const newHub = {
      id: `custom-hub-${Date.now()}`,
      name,
      address: name,
      lat: pendingLatLng.lat,
      lng: pendingLatLng.lng,
      label: name.substring(0, 2).toUpperCase(),
      matchNames: [name.toLowerCase()],
      isCustom: true,
    };

    const stored = JSON.parse(localStorage.getItem(HUBS_STORAGE_KEY) || '[]');
    const updated = [...stored, newHub];
    localStorage.setItem(HUBS_STORAGE_KEY, JSON.stringify(updated));

    setCustomHubs((prev) => [...prev, newHub]);
    if (onHubsChange) {
      onHubsChange([...PAKNAAN_HUBS, ...customHubs, newHub]);
    }

    setPendingLatLng(null);
    setHubNameDraft('');
  }, [hubNameDraft, pendingLatLng, customHubs, onHubsChange]);

  const captureMap = useCallback(async () => {
    setCapturing(true);
    try {
      await captureMapToPng(mapShellRef.current?.querySelector('.location-density-map'));
    } catch (error) {
      console.error('Failed to capture map:', error);
      alert('Sorry, the map could not be captured. Please try again.');
    } finally {
      setCapturing(false);
    }
  }, []);

  const allHubs = useMemo(
    () => [...PAKNAAN_HUBS, ...customHubs].filter((hub) => isValidCoordinate(hub.lat) && isValidCoordinate(hub.lng)),
    [customHubs],
  );

  const hubs = useMemo(
    () => allHubs,
    [allHubs],
  );

  const hubIcons = useMemo(
    () => Object.fromEntries(hubs.map((hub) => [hub.id, createHubIcon(hub.label, hub.isCustom)])),
    [hubs],
  );
  const vehicleGroups = useMemo(() => groupVehiclesByHub(vehicles), [vehicles]);
  const vehicleIcons = useMemo(
    () => Object.fromEntries(
      vehicleGroups.map((group) => [group.hub.id, createVehicleDotIcon(group.vehicles.length)]),
    ),
    [vehicleGroups],
  );

  return (
    <div className="location-density-map-shell" ref={mapShellRef}>
      <div className="location-density-toolbar">
        <span className="location-density-hint">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {addMode ? 'Click anywhere on the map to drop the new hub.' : 'Click "Add Hub", then click the map to pin a new location.'}
        </span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className={`location-density-btn ${addMode ? 'is-active' : 'is-primary'}`}
            onClick={() => setAddMode((prev) => !prev)}
          >
            {addMode ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                Cancel
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                  <circle cx="12" cy="9" r="2.5" fill="currentColor" stroke="none" />
                </svg>
                Add Hub
              </>
            )}
          </button>
          <button
            type="button"
            className="location-density-btn is-secondary"
            onClick={captureMap}
            disabled={capturing}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {capturing ? 'Capturing…' : 'Download Map'}
          </button>
        </div>
      </div>
      <MapContainer
        attributionControl
        center={[PAKNAAN_CENTER.lat, PAKNAAN_CENTER.lng]}
        className="location-density-map"
        maxBounds={PAKNAAN_BOUNDS}
        maxBoundsViscosity={1}
        scrollWheelZoom
        zoom={16}
        zoomControl={false}
      >
        <MapClickHandler addMode={addMode} onPickLocation={handlePickLocation} />
        <TileLayer attribution={CARTO_ATTRIBUTION} maxZoom={19} url={CARTO_DARK_TILE_URL} />
        <Polygon
          pathOptions={{
            color: '#FF7A1A',
            fillColor: '#7C3DFF',
            fillOpacity: 0.08,
            opacity: 0.95,
            weight: 5,
          }}
          positions={PAKNAAN_POLYGON}
        />
        {hubs.map((hub) => (
          <Marker
            icon={hubIcons[hub.id]}
            key={hub.id}
            position={[hub.lat, hub.lng]}
            zIndexOffset={1050}
          >
            <Tooltip
              className="location-density-hub-tooltip"
              direction="top"
              offset={[0, -24]}
              permanent
            >
              {hub.name}
            </Tooltip>
            <Popup className="location-density-hub-popup">
              <div className="location-density-popup">
                <strong>{hub.name}</strong>
                <span>{hub.address}</span>
                <span>Latitude: {hub.lat.toFixed(6)}</span>
                <span>Longitude: {hub.lng.toFixed(6)}</span>
                {hub.isCustom && (
                  <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #22C55E', display: 'flex', gap: '4px' }}>
                    <button
                      onClick={() => {
                        if (confirm(`Delete hub "${hub.name}"?`)) {
                          const stored = JSON.parse(localStorage.getItem(HUBS_STORAGE_KEY) || '[]');
                          const updated = stored.filter((h) => h.id !== hub.id);
                          localStorage.setItem(HUBS_STORAGE_KEY, JSON.stringify(updated));
                          setCustomHubs(updated);
                          if (onHubsChange) {
                            onHubsChange([...PAKNAAN_HUBS, ...updated]);
                          }
                        }
                      }}
                      style={{
                        flex: 1,
                        padding: '4px 8px',
                        fontSize: '0.7rem',
                        backgroundColor: '#DC2626',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline', verticalAlign: 'middle', marginRight: '3px' }}>
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
                      Delete Hub
                    </button>
                  </div>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
        {vehicleGroups.map(({ hub, vehicles: hubVehicles }) => (
          <Marker
            icon={vehicleIcons[hub.id]}
            key={`vehicles-${hub.id}`}
            position={[hub.lat, hub.lng]}
            zIndexOffset={1400}
          >
            <Tooltip
              className="location-density-vehicle-tooltip"
              direction="top"
              offset={[0, -14]}
            >
              {hubVehicles.length} vehicle{hubVehicles.length === 1 ? '' : 's'} at {hub.name}
            </Tooltip>
            <Popup className="location-density-vehicle-popup">
              <div className="location-density-vehicle-popup-content">
                <strong>{hub.name}</strong>
                <span>{hub.address}</span>
                <span>Latitude: {hub.lat}</span>
                <span>Longitude: {hub.lng}</span>
                <div className="location-density-vehicle-list">
                  {hubVehicles.map((vehicle) => (
                    <article className="location-density-vehicle-item" key={vehicle.vehicle_id}>
                      <b>{vehicle.vehicle_name}</b>
                      <span>Plate: {vehicle.plate_number}</span>
                      <span>Type: {vehicle.category?.category_name ?? '-'}</span>
                      <span>Status: {vehicle.status}</span>
                      <span>Condition: {vehicle.condition ?? '-'}</span>
                      <span>Current Location: {vehicle.current_location}</span>
                    </article>
                  ))}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
        <ZoomControl position="bottomright" />
        <FitBoundsToPolygon />
      </MapContainer>

      {pendingLatLng && (
        <div className="hub-modal-overlay" onMouseDown={cancelNaming}>
          <div
            className="hub-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hub-modal-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="hub-modal-header">
              <span className="hub-modal-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                  <circle cx="12" cy="9" r="2.5" fill="currentColor" stroke="none" />
                </svg>
              </span>
              <h3 id="hub-modal-title">Name this location hub</h3>
            </div>

            <p className="hub-modal-coords">
              Lat {pendingLatLng.lat.toFixed(6)} · Lng {pendingLatLng.lng.toFixed(6)}
            </p>

            <label className="hub-modal-label" htmlFor="hub-name-input">Hub name</label>
            <input
              id="hub-name-input"
              ref={nameInputRef}
              className="hub-modal-input"
              type="text"
              placeholder="e.g. Paknaan Health Center"
              value={hubNameDraft}
              onChange={(e) => setHubNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmNaming();
                if (e.key === 'Escape') cancelNaming();
              }}
              maxLength={60}
            />

            <div className="hub-modal-actions">
              <button type="button" className="hub-modal-btn hub-modal-cancel" onClick={cancelNaming}>
                Cancel
              </button>
              <button
                type="button"
                className="hub-modal-btn hub-modal-save"
                onClick={confirmNaming}
                disabled={!hubNameDraft.trim()}
              >
                Save Hub
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LocationDensityMap;
