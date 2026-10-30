import { z } from 'zod';

export const cloudAccountSchema = z.object({
  apiKey: z.string().trim().min(1).max(4096).regex(/^[!-~]+$/, 'Paste the API key without spaces or line breaks.').optional(),
  sshMode: z.enum(['managed', 'existing']),
  privateKeyPath: z.string().trim().max(4096).optional(),
}).strict().refine(value => value.sshMode !== 'existing' || !!value.privateKeyPath, {
  message: 'Enter the path to your private SSH key.', path: ['privateKeyPath'],
});
export type CloudAccountInput = z.infer<typeof cloudAccountSchema>;
export interface CloudAccountStatus {
  apiKeyConfigured: boolean;
  credentialFile: string;
  ssh: { mode: 'managed' | 'existing' | 'legacy'; path: string; publicKey: string | null; fingerprint: string | null; ready: boolean };
  canEdit: boolean;
  blockedReason: string | null;
}
