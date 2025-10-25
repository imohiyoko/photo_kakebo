import crypto from 'crypto';

export function anonymizeUser(raw: string | number | null | undefined): string | null {
  if (!raw) return null;
  return crypto.createHash('sha256').update(String(raw)).digest('hex').slice(0, 16);
}

export interface DiffField {
  field_name: string;
  old_value: any;
  new_value: any;
  edit_type: 'replace' | 'add' | 'delete';
}

export function diffEntryFields(original: Record<string, any>, edited: Record<string, any>): DiffField[] {
  const diffs: DiffField[] = [];
  const fields = new Set([...Object.keys(original), ...Object.keys(edited)]);
  fields.forEach(f => {
    const oldVal = original[f];
    const newVal = edited[f];
    if (oldVal === newVal) return;
    let editType: 'replace' | 'add' | 'delete' = 'replace';
    if ((oldVal == null || oldVal === '') && (newVal != null && newVal !== '')) editType = 'add';
    if ((oldVal != null && oldVal !== '') && (newVal == null || newVal === '')) editType = 'delete';
    diffs.push({ field_name: f, old_value: oldVal, new_value: newVal, edit_type: editType });
  });
  return diffs;
}
