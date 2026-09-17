export interface ListBackgroundPolicy { readonly version: '1.0'; readonly mode: 'own' | 'parent' }
export function listBackgroundPolicyError(value: unknown): string | undefined {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return 'backgroundPolicy must be an object';
 const v = value as Record<string, unknown>;
 if (Object.keys(v).length !== 2 || !Object.hasOwn(v,'version') || !Object.hasOwn(v,'mode')) return 'backgroundPolicy requires only version and mode';
 if(v.version !== '1.0') return 'unsupported List backgroundPolicy version';
 if(v.mode !== 'own' && v.mode !== 'parent') return 'mode must be own or parent';
}
