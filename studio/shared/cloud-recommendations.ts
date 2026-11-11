import type { GpuOffer, OfferFilters } from './cloud';
import { offerMatchesFilters } from './cloud';

// Old component keys stay readable in saved receipts. Capacity is an admission
// requirement, not free points for buying memory the job doesn't use.
export const recommendationWeights = { compute: 0, value: 85, setup: 10, memory: 0, transfer: 0, reliability: 5 } as const;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const cost = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const unit = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const round = (value: number) => Math.round(value * 10) / 10;
const divisor = (value: number) => Math.max(.000001, value);

/** Provider-based value estimate, never a measured H3/Qwen/Clarity render speed. */
export function rankGpuOffers(offers: GpuOffer[], filters: OfferFilters): GpuOffer[] {
  const eligible = offers.filter(offer => offerMatchesFilters(offer, filters));
  const measured = eligible.map(offer => {
    const rated = positive(offer.dlperf) && positive(offer.memoryBandwidth);
    // A fixed reference keeps an unrelated search outlier from changing weights.
    const performanceIndex = rated ? (offer.dlperf! / 100) ** .65 * (offer.memoryBandwidth! / 1000) ** .35 : null;
    const workPerDollar = performanceIndex !== null && cost(offer.totalHourly) ? performanceIndex / divisor(offer.totalHourly) : null;
    const throughput = Math.min(offer.downloadMbps / 8, positive(offer.diskBandwidth) ? offer.diskBandwidth : Infinity);
    const transferSeconds = positive(throughput) && positive(offer.modelDownloadGB) ? offer.modelDownloadGB * 1000 / throughput : null;
    const transferComputeCost = transferSeconds !== null && cost(offer.totalHourly) ? transferSeconds / 3600 * offer.totalHourly : null;
    // Cost of one reference-hour of work plus one cold model transfer. Only ten
    // points use this scenario; a small network gain cannot dominate rental value.
    const sessionCost = performanceIndex !== null && cost(offer.totalHourly) && cost(offer.modelDownloadCost) && transferComputeCost !== null
      ? offer.totalHourly / performanceIndex + offer.modelDownloadCost + transferComputeCost : null;
    return { offer, rated, performanceIndex, workPerDollar, transferSeconds, transferComputeCost, sessionCost };
  });
  const bestValue = Math.max(0, ...measured.map(row => row.workPerDollar || 0));
  const sessionCosts = measured.map(row => row.sessionCost).filter(cost);
  const cheapestSession = sessionCosts.length ? Math.min(...sessionCosts) : null;
  const scored = measured.map(row => {
    const { offer } = row;
    const components = { compute: 0, value: round(unit((row.workPerDollar || 0) / bestValue) * recommendationWeights.value),
      setup: round(row.sessionCost !== null && cheapestSession !== null ? unit(divisor(cheapestSession) / divisor(row.sessionCost)) * recommendationWeights.setup : 0),
      memory: 0, transfer: 0, reliability: round(unit(offer.reliability) * recommendationWeights.reliability) };
    return { ...offer, recommendation: { version: 'value-v2' as const, score: round(Object.values(components).reduce((sum, value) => sum + value, 0)),
      rank: null as number | null, confidence: row.rated ? 'rated' as const : 'limited' as const, components,
      performanceIndex: row.performanceIndex, workPerDollar: row.workPerDollar, sessionCost: row.sessionCost,
      transferSeconds: row.transferSeconds, transferComputeCost: row.transferComputeCost,
      firstHourCost: cost(offer.totalHourly) && cost(offer.modelDownloadCost) ? offer.totalHourly + offer.modelDownloadCost : null } };
  }).sort((a, b) => b.recommendation.score - a.recommendation.score || (a.totalHourly ?? Infinity) - (b.totalHourly ?? Infinity) || a.id - b.id);
  const machines = new Set<number>(); let rank = 0;
  for (const offer of scored) if (offer.recommendation.confidence === 'rated' && !machines.has(offer.machineId) && rank < 3) {
    machines.add(offer.machineId); offer.recommendation.rank = ++rank;
  }
  return scored;
}
