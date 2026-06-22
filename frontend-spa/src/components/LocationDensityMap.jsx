import { useEffect, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, Marker, Polygon, Popup, TileLayer, Tooltip, useMap, ZoomControl } from 'react-leaflet';
import { PAKNAAN_BOUNDS, PAKNAAN_CENTER, PAKNAAN_HUBS, PAKNAAN_POLYGON } from '../data/paknaanLocationDensity';

const CARTO_DARK_TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const CARTO_ATTRIBUTION = '&copy; OpenStreetMap contributors &copy; CARTO';

function createHubIcon(label) {
  return L.divIcon({
    className: 'location-density-hub-icon',
    html: `
      <svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42" aria-hidden="true">
        <circle cx="21" cy="21" r="20" fill="#052E16" stroke="#22C55E" stroke-width="2"/>
        <circle cx="21" cy="21" r="15" fill="#14532D" stroke="#86EFAC" stroke-width="1"/>
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

function findHubForVehicle(vehicle) {
  const location = normalizeLocation(vehicle.current_location);

  if (!location) {
    return null;
  }

  return PAKNAAN_HUBS.find((hub) => (
    hub.matchNames.some((name) => location === normalizeLocation(name))
  )) ?? null;
}

function groupVehiclesByHub(vehicles) {
  const groups = new Map();

  vehicles.forEach((vehicle) => {
    const hub = findHubForVehicle(vehicle);

    if (!hub || !isValidCoordinate(hub.lat) || !isValidCoordinate(hub.lng)) {
      return;
    }

    const currentGroup = groups.get(hub.id) ?? { hub, vehicles: [] };
    currentGroup.vehicles.push(vehicle);
    groups.set(hub.id, currentGroup);
  });

  return Array.from(groups.values());
}

function FitBoundsToPolygon() {
  const map = useMap();

  useEffect(() => {
    const bounds = L.latLngBounds(PAKNAAN_POLYGON);
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 });
  }, [map]);

  return null;
}

function LocationDensityMap({ vehicles = [] }) {
  const hubs = useMemo(
    () => PAKNAAN_HUBS.filter((hub) => isValidCoordinate(hub.lat) && isValidCoordinate(hub.lng)),
    [],
  );

  const hubIcons = useMemo(
    () => Object.fromEntries(hubs.map((hub) => [hub.id, createHubIcon(hub.label)])),
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
    <div className="location-density-map-shell">
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
                <span>Latitude: {hub.lat}</span>
                <span>Longitude: {hub.lng}</span>
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
    </div>
  );
}

export default LocationDensityMap;
