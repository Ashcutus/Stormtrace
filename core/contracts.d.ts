/** Documentation contracts for the existing JavaScript runtime. Times are UTC epoch milliseconds. */
export type EventKind = 'lightning' | 'warning' | 'earthquake' | 'cyclone' | 'volcano' | 'tsunami' | 'space_weather';
export type Position = [longitude: number, latitude: number, ...altitude: number[]];
export type Geometry = { type: 'Point'; coordinates: Position } | { type: 'LineString'; coordinates: Position[] } | { type: 'MultiLineString' | 'Polygon'; coordinates: Position[][] } | { type: 'MultiPolygon'; coordinates: Position[][][] };
export interface Provenance { provider: string; sourceAuthority: string; sourceUrl: string; upstreamId: string | null; fetchedAt: number; observedAt: number | null; updatedAt: number | null; transformations: string[] }
export interface StormtraceEvent<K extends EventKind, P, S = unknown> { id: string; kind: K; provider: string; sourceAuthority: string; observedAt: number | null; updatedAt: number | null; validFrom: number | null; validTo: number | null; geometry: Geometry | null; sourceSeverity: S; displayPriority: 'low' | 'normal' | 'high' | 'urgent'; provenance: Provenance; domainPayload: P }
export interface WeatherWarningPayload { headline: string; description: string; instruction: string; cap?: unknown; classification: string }
export interface EarthquakePayload { magnitude: number; magnitudeType: string; depthKm: number; status: string }
export interface CyclonePayload { classification: string; tracks: Geometry[]; forecast: { at: number; geometry: Geometry; classification: string }[]; cones: Geometry[] }
export interface VolcanoPayload { volcanoId: string; activity: string; aviationColour?: string; bulletin: string }
export interface TsunamiPayload { bulletin: string; areas: string[]; waveForecast?: { at: number; heightMetres: number; location: Position }[] }
export interface SpaceWeatherEventPayload { eventType: string; linkedEvents: string[]; nativeScales: { scale: string; value: string }[] }
export interface LightningPayload { polarity: number; deviation: number }
export interface GeoQuery { bounds?: [number, number, number, number] }
export interface TimeWindow { from: number; to: number }
export interface ProviderHealth { lastAttemptedFetch: number | null; lastSuccessfulFetch: number | null; sourceDataTimestamp: number | null; expectedUpdateInterval: number | null; lastError: ProviderError | null; consecutiveFailures: number; available: boolean; freshnessBasis?: 'source' | 'fetch' }
export interface ProviderError { code: 'network' | 'upstream' | 'timeout' | 'authentication' | 'rate_limited' | 'malformed' | 'unsupported_schema' | 'stale' | 'configuration' | 'parse' | 'unavailable'; provider: string; operation: string; status: number | null; retryAfter: string | null }
export type SourceClassification = 'OPEN_DATA' | 'PUBLIC_GOVERNMENT' | 'FREE_HOSTED_NONCOMMERCIAL' | 'FREE_HOSTED_BEST_EFFORT' | 'AUTH_REQUIRED_FREE' | 'COMMERCIAL_PERMISSION_REQUIRED';
export interface ProviderSource { id: string; name: string; authority: string; description: string; categories: string[]; coverage: string; homepage: string; attribution: string; licence: { classification: SourceClassification; termsUrl: string; notes: string }; authentication: string; expectedUpdateInterval: number | null; historicalData: boolean | 'verify_before_implementation'; commercialUse: string; status: string; notes: string }
export interface Provider { id: string; source: ProviderSource; health: ProviderHealth }
export interface DataResult<T> { records: T[]; sourceDataTimestamp: number | null; health?: ProviderHealth }
export interface RadarFrame { id: string; observedAt: number; bounds: [number, number, number, number]; resource: { url: string; format: string }; provenance: Provenance }
export interface RadarProvider extends Provider { frames(query: GeoQuery & Partial<TimeWindow>): Promise<DataResult<RadarFrame>> }
export interface WarningProvider extends Provider { current(query: GeoQuery): Promise<DataResult<StormtraceEvent<'warning', WeatherWarningPayload>>> }
export interface EarthquakeProvider extends Provider { query(query: GeoQuery & TimeWindow): Promise<DataResult<StormtraceEvent<'earthquake', EarthquakePayload>>> }
export interface CycloneProvider extends Provider { current(query: GeoQuery): Promise<DataResult<StormtraceEvent<'cyclone', CyclonePayload>>> }
export interface VolcanoProvider extends Provider { current(query: GeoQuery): Promise<DataResult<StormtraceEvent<'volcano', VolcanoPayload>>> }
export interface TsunamiProvider extends Provider { current(query: GeoQuery): Promise<DataResult<StormtraceEvent<'tsunami', TsunamiPayload>>> }
export interface SpaceWeatherMeasurement { at: number; metric: string; value: number; unit: string; sourceSeverity?: unknown; provenance: Provenance }
export interface SpaceWeatherProvider extends Provider { }
export interface SpaceWeatherStateProvider extends SpaceWeatherProvider { current(): Promise<DataResult<SpaceWeatherMeasurement>> }
export interface SpaceWeatherSeriesProvider extends SpaceWeatherProvider { series(query: TimeWindow): Promise<DataResult<SpaceWeatherMeasurement>> }
export interface SpaceWeatherEventProvider extends SpaceWeatherProvider { query(query: TimeWindow): Promise<DataResult<StormtraceEvent<'space_weather', SpaceWeatherEventPayload>>> }
/** Optional capabilities, only implement when upstream supports them. */
export interface HistoricalProvider<T> { history(query: TimeWindow & GeoQuery): Promise<DataResult<T>> }
export interface DetailProvider<T> { detail(id: string): Promise<T> }
export interface LocationAdapter { available(): boolean; current(): Promise<{ coords: { latitude: number; longitude: number; accuracy: number } }> }
export interface NotificationIntent { title: string; body: string; icon?: string; tag?: string }
export interface NotificationAdapter { permission(): string; requestPermission(): Promise<string>; show(intent: NotificationIntent): { close(): void; onclick?: () => void } }
/** update is atomic, including across connections; null deletes; returned values are detached. */
export interface StorageAdapter { get(key: string): Promise<unknown>; update(key: string, mutate: (existing: any) => any): Promise<void>; entries(): Promise<[string, any][]> }

export interface MetOfficeWarningPayload extends WeatherWarningPayload { status: 'ISSUED' | 'CANCELLED' | 'EXPIRED'; version: string; weatherTypes: string[]; whatToExpect: string[]; updateReason: string; affectedAreas: { regionName: string; regionCode: string; subRegions: string[] }[]; sourceFields: Record<string, unknown> }
