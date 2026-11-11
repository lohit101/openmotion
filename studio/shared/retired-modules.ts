/** Old paid runs stay readable/recoverable. Retired features cannot create work. */
export function retiredFeatureRequest(method: string, path: string, body?: { module?: string }) {
  if (/^\/api\/characters(?:\/|$)/.test(path)) return 'Characters has been removed. Existing reference images remain in Library.';
  if (path === '/api/images/local-identity') return 'The older Imagen workflow has been removed. Open Imagen to use the current editor.';
  if (/^\/api\/video-identity(?:\/|$)/.test(path) || method === 'POST' && /^\/api\/jobs\/[^/]+\/refine-face$/.test(path))
    return 'The older ONNX face-refinement tool has been removed. Use Post-processing → Fix Faces.';
  if (method !== 'POST') return null;
  if (path === '/api/models/module' && ['imagen', 'remotion'].includes(body?.module || ''))
    return 'This workflow has been retired. Open the current Imagen or Remotion workspace to download its selected files.';
  if (path === '/api/facial-consistency/prepare' ||
      /^\/api\/images\/(?:draft|mask\/[^/]+|jobs(?:\/[^/]+\/use)?)$/.test(path))
    return 'This workflow has been retired. Use Imagen for image editing or Remotion for video generation. Saved runs remain in Library.';
  return null;
}
