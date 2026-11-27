export interface PolicySource { id: string; label: string; realm: string; region: string }
export interface PolicyMatch { name: string; groups: ('shared_network' | 'environment')[]; candidates: { id: string; description: string }[] }
export interface PolicyPreview {
  source: PolicySource;
  matches: PolicyMatch[];
  unused: { id: string; name: string; description: string }[];
  complete: boolean;
}
