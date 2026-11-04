import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaults, settingsSchema } from '../shared/types';
import { facialRuntimeReadyForSettings, facialVersionForSettings, facialProgressForRun, isBoundaryFacialVersion, isCalibratedFacialVersion,
  isCleanupFacialVersion, isEyeFinishedFacialVersion, isGeometryFacialVersion, isOcclusionTrackedFacialVersion } from '../shared/facial-consistency';
import { emptyModels, facialFilesForSettings, facialOcclusionModelFiles, modelBytes, modelDefinitions, modelFilesForSettings } from '../shared/models';
import { moduleDownloadPlan } from '../shared/module-downloads';
import { Store } from '../server/store';
import FacialConsistencyControls from '../src/FacialConsistencyControls';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const selected = { ...defaults, engine: 'viggle' as const, facialConsistency: 'perform-onnx60' as const,
  facialSceneMatch: true, facialFeatureCleanup: true, facialEyeCalibration: true, facialEyeFinish: false,
  facialBoundaryBlend: true, facialOcclusionTracking: true };

describe('foreground-tracked facial finish selection', () => {
  it('separates new preferences from legacy missing fields and explicit opt-outs', () => {
    expect(defaults.facialOcclusionTracking).toBe(true);
    expect(settingsSchema.parse({}).facialOcclusionTracking).toBe(false);
    expect(settingsSchema.parse({ facialOcclusionTracking: false }).facialOcclusionTracking).toBe(false);
    const root = mkdtempSync(path.join(os.tmpdir(), 'recast-face-preferences-')); roots.push(root);
    const store = new Store(root);
    try {
      expect(store.draft().settings.facialOcclusionTracking).toBe(true);
      const { facialOcclusionTracking: _missing, ...legacy } = selected;
      store.set('draft', { sourceId: null, referenceId: null, settings: legacy });
      const saved = store.value('draft', null);
      expect(store.draft().settings.facialOcclusionTracking).toBe(false);
      expect(facialVersionForSettings(store.draft().settings)).toBe('source-face-v10');
      expect(store.value('draft', null)).toEqual(saved);
      for (const flag of [false, true]) {
        store.set('draft', { sourceId: null, referenceId: null, settings: { ...selected, facialOcclusionTracking: flag } });
        expect(store.draft().settings.facialOcclusionTracking).toBe(flag);
      }
    } finally { store.close(); }
  });

  it('requires the full calibrated Standard boundary recipe and an explicit saved flag', () => {
    expect(facialVersionForSettings(selected)).toBe('source-face-v11');
    expect(facialVersionForSettings({ ...selected, facialOcclusionTracking: false })).toBe('source-face-v10');
    const { facialOcclusionTracking: _missing, ...legacy } = selected;
    expect(facialVersionForSettings(legacy)).toBe('source-face-v10');
    expect(facialVersionForSettings({ ...selected, facialConsistency: 'regional-onnx60' })).toBe('source-face-v9');
    expect(facialVersionForSettings({ ...selected, facialEyeCalibration: false })).toBe('source-face-v9');
    expect(facialVersionForSettings({ ...selected, facialBoundaryBlend: false })).toBe('source-face-v7');
    expect(facialVersionForSettings({ ...selected, facialEyeFinish: true })).toBe('source-face-v8');
    expect(facialVersionForSettings({ ...selected, facialFeatureCleanup: false })).toBe('source-face-v2');
    expect(facialVersionForSettings({ ...selected, facialSceneMatch: false })).toBe('source-face-v1');
    for (const matches of [isBoundaryFacialVersion, isCalibratedFacialVersion, isCleanupFacialVersion, isGeometryFacialVersion, isOcclusionTrackedFacialVersion])
      expect(matches('source-face-v11')).toBe(true);
    expect(isEyeFinishedFacialVersion('source-face-v11')).toBe(false);
  });

  it('requires the new runtime capability as well as all inherited tools', () => {
    const ready = { facialCalibratedRuntimeReady: true, facialGeometryRuntimeReady: true, facialBoundaryRuntimeReady: true };
    expect(facialRuntimeReadyForSettings(selected, ready)).toBe(false);
    const all = { ...ready, facialOcclusionRuntimeReady: true };
    expect(facialRuntimeReadyForSettings(selected, all)).toBe(true);
    for (const key of ['facialCalibratedRuntimeReady', 'facialGeometryRuntimeReady', 'facialBoundaryRuntimeReady', 'facialOcclusionRuntimeReady'] as const)
      expect(facialRuntimeReadyForSettings(selected, { ...all, [key]: false })).toBe(false);
    expect(facialRuntimeReadyForSettings({ ...selected, facialOcclusionTracking: false }, ready)).toBe(true);
    expect(facialRuntimeReadyForSettings({ ...selected, facialConsistency: 'off' }, {})).toBe(true);
  });

  it('reports preparation as work units without inventing completed facial frames', () => {
    expect(facialProgressForRun('source-face-v11', 24, 60, 144)).toEqual({ completed: 60, total: 144, processedFrames: 0, multistage: true });
    expect(facialProgressForRun('source-face-v11', 24, 132, 144)?.processedFrames).toBe(12);
    expect(facialProgressForRun('source-face-v11', 24, 12, 24)).toEqual({ completed: 132, total: 144, processedFrames: 12, multistage: true });
    expect(facialProgressForRun('source-face-v11', 24, 24, 24)?.completed).toBe(144);
    expect(facialProgressForRun('source-face-v10', 24, 12, 24)).toEqual({ completed: 12, total: 24, processedFrames: 12, multistage: false });
    expect(facialProgressForRun('source-face-v8', 24, 84, 96)?.processedFrames).toBe(12);
    expect(facialProgressForRun('source-face-v11', 24, 10, 96)).toBeNull();
    expect(facialProgressForRun('source-face-v11', 24, 145, 144)).toBeNull();
  });

  it('requests only the four selected tracking files and matching preparation capability', () => {
    expect(facialOcclusionModelFiles).toHaveLength(4);
    expect(modelBytes(facialOcclusionModelFiles)).toBe(278680312);
    expect(facialFilesForSettings(selected).filter(id => facialOcclusionModelFiles.includes(id))).toEqual(facialOcclusionModelFiles);
    for (const settings of [{ ...selected, facialOcclusionTracking: false }, { ...selected, facialConsistency: 'regional-onnx60' as const },
      { ...selected, facialEyeFinish: true }, { ...selected, facialBoundaryBlend: false }])
      expect(facialFilesForSettings(settings).some(id => facialOcclusionModelFiles.includes(id))).toBe(false);
    expect(modelFilesForSettings({ ...selected, facialConsistency: 'off' }).some(id => facialOcclusionModelFiles.includes(id))).toBe(false);
    const plan = moduleDownloadPlan('remotion', selected);
    expect(plan.runtimes).toEqual(['viggle-tools', 'facial:source-face-v11']);
    expect(plan.files.filter(id => facialOcclusionModelFiles.includes(id))).toEqual(facialOcclusionModelFiles);
    expect(modelDefinitions.filter(file => facialOcclusionModelFiles.includes(file.id)).every(file => file.engine === 'facial' && file.experimental && !file.included)).toBe(true);
  });

  it('keeps the preference visible and checked while explaining incompatible settings', () => {
    const downloads = { state: emptyModels(), online: false, blocked: false } as any;
    const render = (profile: 'perform-onnx60' | 'regional-onnx60', flag: boolean) => renderToStaticMarkup(
      <FacialConsistencyControls value={profile} change={() => {}} downloads={downloads} cleanup sceneMatch eyeCalibration
        boundaryBlend occlusionTracking={flag} changeOcclusionTracking={() => {}} />);
    const switchTag = (html: string) => html.match(/<button[^>]*aria-label="Protect hands &amp; track visible eyes · beta"[^>]*>/)?.[0] || '';
    expect(switchTag(render('perform-onnx60', true))).toContain('aria-checked="true"');
    expect(switchTag(render('perform-onnx60', true))).not.toContain('disabled');
    expect(switchTag(render('perform-onnx60', false))).toContain('aria-checked="false"');
    expect(switchTag(render('regional-onnx60', true))).toContain('aria-checked="true"');
    expect(switchTag(render('regional-onnx60', true))).toContain('disabled');
    expect(render('regional-onnx60', true)).toContain('Available with Standard + ONNX 60%');
  });
});
