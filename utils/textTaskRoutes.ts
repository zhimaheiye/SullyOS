import type { FeatureApiId, TextFeatureApi } from './featureApi';

/** Public builds use ordinary user-configured APIs only. */
export const canRunTextTask = (_id: FeatureApiId, api: Partial<TextFeatureApi> | null | undefined): boolean =>
  !!(api?.baseUrl?.trim() && api?.model?.trim());
