import type { Store } from './store';
import type { MarketRequirements, OfferFilters } from '../shared/cloud';
import { marketplaceFilters, gpuMarketplaceMinimums } from '../shared/cloud';
import { downloadableModelDefinitions, modelBytes, modelWorkingReserve } from '../shared/models';

/** Rental sizing follows the retained Studio stack, independently of editable drafts. */
export function marketRequirements(_store: Store, input: OfferFilters): { requirements: MarketRequirements; filters: OfferFilters } {
  const files = [...new Set(downloadableModelDefinitions.map(file => file.id))];
  const minDisk = Math.max(gpuMarketplaceMinimums.disk, Math.ceil((modelBytes(files) + 20e9 + modelWorkingReserve(files)) / 8e9) * 8);
  const requirements: MarketRequirements = { workflow: 'all', minVram: gpuMarketplaceMinimums.minVram, minRam: gpuMarketplaceMinimums.ram,
    minDisk, recommendedDisk: minDisk + 16, modelGB: modelBytes(files) / 1e9, architectures: ['amd64'] };
  const filters = marketplaceFilters(input);
  return { requirements, filters: { ...filters, disk: Math.max(filters.disk, minDisk) } };
}
