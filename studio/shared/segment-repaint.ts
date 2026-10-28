import type { CharacterSnapshot } from './characters';
import type { ImageSettings } from './image-replacement';

export interface SegmentRepaint {
  segment: number; frame: number; status: 'provided' | 'preparing' | 'rendering' | 'completed' | 'skipped';
  photoJobId?: string; targetSHA256?: string; anchorSHA256?: string; referenceSHA256?: string; referenceFile?: string; warning?: string;
  previousPhotoJobIds?: string[];
}
export interface ViggleRepaintRun {
  version: 'imagen-face-v1'; character: CharacterSnapshot; imageSettings: ImageSettings; initialImageJobId?: string;
  records: SegmentRepaint[]; activePhotoId?: string; photoProgress?: { stage: string; value: number | null; max: number | null };
}
