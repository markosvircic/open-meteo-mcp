import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import type {
  AirQualityParams,
  ArchiveParams,
  ClimateParams,
  DwdIconParams,
  EcmwfParams,
  ElevationParams,
  ElevationResponse,
  EnsembleParams,
  FloodParams,
  ForecastParams,
  GemParams,
  GeocodingParams,
  GeocodingResponse,
  GfsParams,
  JmaParams,
  MarineParams,
  MeteoFranceParams,
  MetnoParams,
  SeasonalParams,
  WeatherResponse,
} from './types.js';

export class OpenMeteoClient {
  private client: AxiosInstance;
  private airQualityClient: AxiosInstance;
  private marineClient: AxiosInstance;
  private archiveClient: AxiosInstance;
  private seasonalClient: AxiosInstance;
  private ensembleClient: AxiosInstance;
  private geocodingClient: AxiosInstance;
  private floodClient: AxiosInstance;
  private climateClient: AxiosInstance;

  constructor(
    baseURL: string = process.env.OPEN_METEO_API_URL || 'https://api.open-meteo.com',
    version = 'unknown',
  ) {
    const config = {
      timeout: 30000,
      headers: {
        Accept: 'application/json',
        'User-Agent': `Open-Meteo-MCP-Server/${version}`,
      },
    };

    // Utilisation des variables d'environnement avec des valeurs par défaut
    const airQualityURL =
      process.env.OPEN_METEO_AIR_QUALITY_API_URL || 'https://air-quality-api.open-meteo.com';
    const marineURL = process.env.OPEN_METEO_MARINE_API_URL || 'https://marine-api.open-meteo.com';
    const archiveURL =
      process.env.OPEN_METEO_ARCHIVE_API_URL || 'https://archive-api.open-meteo.com';
    const seasonalURL =
      process.env.OPEN_METEO_SEASONAL_API_URL || 'https://seasonal-api.open-meteo.com';
    const ensembleURL =
      process.env.OPEN_METEO_ENSEMBLE_API_URL || 'https://ensemble-api.open-meteo.com';
    const geocodingURL =
      process.env.OPEN_METEO_GEOCODING_API_URL || 'https://geocoding-api.open-meteo.com';
    const floodURL = process.env.OPEN_METEO_FLOOD_API_URL || 'https://flood-api.open-meteo.com';
    const climateURL =
      process.env.OPEN_METEO_CLIMATE_API_URL || 'https://climate-api.open-meteo.com';

    this.client = axios.create({ baseURL, ...config });
    this.airQualityClient = axios.create({ baseURL: airQualityURL, ...config });
    this.marineClient = axios.create({ baseURL: marineURL, ...config });
    this.archiveClient = axios.create({ baseURL: archiveURL, ...config });
    this.seasonalClient = axios.create({ baseURL: seasonalURL, ...config });
    this.ensembleClient = axios.create({ baseURL: ensembleURL, ...config });
    this.geocodingClient = axios.create({ baseURL: geocodingURL, ...config });
    this.floodClient = axios.create({ baseURL: floodURL, ...config });
    this.climateClient = axios.create({ baseURL: climateURL, ...config });

    this.setupErrorInterceptors();
  }

  private setupErrorInterceptors(): void {
    for (const instance of [
      this.client,
      this.airQualityClient,
      this.marineClient,
      this.archiveClient,
      this.seasonalClient,
      this.ensembleClient,
      this.geocodingClient,
      this.floodClient,
      this.climateClient,
    ]) {
      instance.interceptors.response.use(undefined, (error: unknown) =>
        this.retryOrMap(instance, error),
      );
    }
  }

  /**
   * Waits between retries, in ms. Override with OPEN_METEO_RETRY_DELAYS_MS="3000,10000,20000"
   * (empty string disables retrying). Total stays well under typical MCP client timeouts.
   */
  private static retryDelays(): number[] {
    const raw = process.env.OPEN_METEO_RETRY_DELAYS_MS;
    if (raw === undefined) return [3000, 10000, 20000];
    return raw
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v) && v >= 0);
  }

  /**
   * Retries a failed request when retrying can help: HTTP 429 caused by the per-minute limit
   * (shared egress IPs on hosts like Render hit it often), HTTP 5xx, and network errors.
   * A 429 caused by the hourly or daily limit is not retried, since it will not clear in seconds.
   */
  private async retryOrMap(instance: AxiosInstance, error: unknown): Promise<never> {
    if (axios.isAxiosError(error) && error.config) {
      const status = error.response?.status;
      const data = error.response?.data as Record<string, unknown> | undefined;
      const reason = String(data?.reason ?? data?.error ?? '');
      const config = error.config as InternalAxiosRequestConfig & { __retryCount?: number };
      const attempt = config.__retryCount ?? 0;
      const delays = OpenMeteoClient.retryDelays();

      const retryable =
        (status === 429 && !/hourly|daily/i.test(reason)) ||
        (status !== undefined && status >= 500) ||
        (status === undefined && error.code !== 'ECONNABORTED');

      if (retryable && attempt < delays.length) {
        config.__retryCount = attempt + 1;
        const retryAfter = Number(error.response?.headers?.['retry-after']);
        const delay =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 30000)
            : delays[attempt];
        console.error(
          `[open-meteo] ${status ?? error.code ?? 'network error'}${reason ? ` (${reason})` : ''} on ${config.url}; retry ${attempt + 1}/${delays.length} in ${delay} ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        return instance.request(config);
      }
    }
    return OpenMeteoClient.mapHttpError(error);
  }

  private static mapHttpError(error: unknown): never {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = error.response?.data as Record<string, unknown> | undefined;
      const apiMessage =
        (data?.reason as string | undefined) ??
        (data?.error as string | undefined) ??
        error.message;

      if (status === 400) throw new Error(`Invalid request parameters: ${apiMessage}`);
      if (status === 422) throw new Error(`Invalid parameter value: ${apiMessage}`);
      if (status === 429)
        throw new Error(`Open-Meteo rate limit reached. Please retry later. (${apiMessage})`);
      if (status !== undefined && status >= 500)
        throw new Error(`Open-Meteo server error (${status}): ${apiMessage}`);
    }
    throw error;
  }

  private buildParams(params: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          result[key] = value.join(',');
        } else {
          result[key] = String(value);
        }
      }
    }

    return result;
  }

  async getForecast(params: ForecastParams): Promise<WeatherResponse> {
    const response = await this.client
      .get('/v1/forecast', { params: this.buildParams(params) })
      .catch(OpenMeteoClient.mapHttpError);
    return response.data;
  }

  async getArchive(params: ArchiveParams): Promise<WeatherResponse> {
    const response = await this.archiveClient
      .get('/v1/archive', { params: this.buildParams(params) })
      .catch(OpenMeteoClient.mapHttpError);
    return response.data;
  }

  async getDwdIcon(params: DwdIconParams): Promise<WeatherResponse> {
    const response = await this.client
      .get('/v1/dwd-icon', { params: this.buildParams(params) })
      .catch(OpenMeteoClient.mapHttpError);
    return response.data;
  }

  async getGfs(params: GfsParams): Promise<WeatherResponse> {
    const response = await this.client
      .get('/v1/gfs', { params: this.buildParams(params) })
      .catch(OpenMeteoClient.mapHttpError);
    return response.data;
  }

  async getMeteoFrance(params: MeteoFranceParams): Promise<WeatherResponse> {
    const response = await this.client
      .get('/v1/meteofrance', { params: this.buildParams(params) })
      .catch(OpenMeteoClient.mapHttpError);
    return response.data;
  }

  async getEcmwf(params: EcmwfParams): Promise<WeatherResponse> {
    const response = await this.client
      .get('/v1/ecmwf', { params: this.buildParams(params) })
      .catch(OpenMeteoClient.mapHttpError);
    return response.data;
  }

  async getJma(params: JmaParams): Promise<WeatherResponse> {
    const response = await this.client
      .get('/v1/jma', { params: this.buildParams(params) })
      .catch(OpenMeteoClient.mapHttpError);
    return response.data;
  }

  async getMetno(params: MetnoParams): Promise<WeatherResponse> {
    const response = await this.client
      .get('/v1/metno', { params: this.buildParams(params) })
      .catch(OpenMeteoClient.mapHttpError);
    return response.data;
  }

  async getGem(params: GemParams): Promise<WeatherResponse> {
    const response = await this.client
      .get('/v1/gem', { params: this.buildParams(params) })
      .catch(OpenMeteoClient.mapHttpError);
    return response.data;
  }

  async getAirQuality(params: AirQualityParams): Promise<WeatherResponse> {
    const response = await this.airQualityClient
      .get('/v1/air-quality', { params: this.buildParams(params) })
      .catch(OpenMeteoClient.mapHttpError);
    return response.data;
  }

  async getMarine(params: MarineParams): Promise<WeatherResponse> {
    const response = await this.marineClient
      .get('/v1/marine', { params: this.buildParams(params) })
      .catch(OpenMeteoClient.mapHttpError);
    return response.data;
  }

  async getEnsemble(params: EnsembleParams): Promise<WeatherResponse> {
    const response = await this.ensembleClient
      .get('/v1/ensemble', { params: this.buildParams(params) })
      .catch(OpenMeteoClient.mapHttpError);
    return response.data;
  }

  async getElevation(params: ElevationParams): Promise<ElevationResponse> {
    const response = await this.client
      .get('/v1/elevation', { params: this.buildParams(params) })
      .catch(OpenMeteoClient.mapHttpError);
    return response.data;
  }

  async getFlood(params: FloodParams): Promise<WeatherResponse> {
    const response = await this.floodClient
      .get('/v1/flood', { params: this.buildParams(params) })
      .catch(OpenMeteoClient.mapHttpError);
    return response.data;
  }

  async getSeasonal(params: SeasonalParams): Promise<WeatherResponse> {
    const response = await this.seasonalClient
      .get('/v1/seasonal', { params: this.buildParams(params) })
      .catch(OpenMeteoClient.mapHttpError);
    return response.data;
  }

  async getClimate(params: ClimateParams): Promise<WeatherResponse> {
    const response = await this.climateClient
      .get('/v1/climate', { params: this.buildParams(params) })
      .catch(OpenMeteoClient.mapHttpError);
    return response.data;
  }

  async getGeocoding(params: GeocodingParams): Promise<GeocodingResponse> {
    const response = await this.geocodingClient
      .get('/v1/search', { params: this.buildParams(params) })
      .catch(OpenMeteoClient.mapHttpError);
    return response.data;
  }
}
