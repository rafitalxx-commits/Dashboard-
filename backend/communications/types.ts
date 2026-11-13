export type Actor = {
    id: string;
    username: string;
    name: string;
    role: string;
    active?: boolean;
    permissions?: string[];
    theme?: string;
};
export const permissionKeys = ['access', 'privateChat', 'participate', 'sendNormal', 'sendImportant', 'sendUrgent', 'attachPhoto', 'attachDocument', 'consult', 'supervise'] as const;
export type Permission = typeof permissionKeys[number];
export type Grants = Record<Permission, boolean>;
export type Priority = 'normal' | 'important' | 'urgent';
export type Confirmation = 'none' | 'read' | 'understood' | 'resolution';
export const defaults = { importantBlocks: true, normalRequiredConfirmation: 'none', importantRequiredConfirmation: 'none', urgentRepeatSeconds: 60, escalateMinutes: 10, normalSound: false, importantSound: true, urgentSound: true, urgentMandatory: true, quietStart: '', quietEnd: '', allowUrgentSnooze: false, snoozeMinutes: 5, imageMaxMB: 10, documentMaxMB: 20, maxAttachments: 5 };
export class CommError extends Error {
    status: number;
    constructor(message: string, status = 400) { super(message); this.status = status; }
}
export function check(ok: unknown, message: string, status = 400): asserts ok { if (!ok)
    throw new CommError(message, status); }
export const now = () => new Date().toISOString();
export function text(value: unknown, max = 20000) { check(typeof value === 'string', 'Texto inválido'); const result = value.trim(); check(result.length <= max, 'Texto demasiado largo'); return result; }
