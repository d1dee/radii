import { createContext, useEffect, useEffectEvent, useRef, useState } from 'react';
import { z } from 'zod';
import { createPackageSchema, PACKAGE_AUDIENCE_METRICS } from '@shared/index';

// Drafts deliberately accept empty/invalid numbers, but never arbitrary objects
// that could crash the editor. Only explicit Save runs business validation.
const numberEntry = z.union([z.number().finite(), z.string().max(100)]);
const shape = createPackageSchema.shape;
const valuesSchema = z.object({
    ...shape,
    title: z.string(),
    category: z.string(),
    nasDeviceIds: z.array(z.uuid()),
    ...Object.fromEntries(Object.entries(shape)
        .filter(([key]) => !['title', 'type', 'category', 'noExpiry', 'description', 'note', 'nasDeviceIds', 'audienceId', 'eligibility', 'fairUsageWindowUnit'].includes(key))
        .map(([key]) => [key, numberEntry])),
    eligibility: z.object({
        mode: z.enum(['all', 'any']),
        rules: z.array(z.object({
            metric: z.enum(Object.keys(PACKAGE_AUDIENCE_METRICS) as [keyof typeof PACKAGE_AUDIENCE_METRICS]),
            operator: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'includes_any', 'includes_all', 'includes_none']),
            value: z.union([numberEntry, z.boolean(), z.array(z.string().max(200)).max(500)]),
            windowDays: numberEntry.nullable().optional(),
            serviceScope: z.enum(['all', 'hotspot', 'pppoe']).optional(),
        }).strict().superRefine((rule, ctx) => {
            const type = PACKAGE_AUDIENCE_METRICS[rule.metric].type;
            const valid = type === 'set' ? Array.isArray(rule.value)
                : type === 'boolean' ? typeof rule.value === 'boolean'
                    : typeof rule.value === 'number' || typeof rule.value === 'string';
            if (!valid) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Invalid rule value shape' });
        })).max(100),
        maxRedemptions: numberEntry.nullable().optional(),
        cooldownDays: numberEntry.nullable().optional(),
    }).strict().nullable().optional(),
}).strict();

const controlSchema = z.object({ value: numberEntry, unit: z.string().max(30) }).strict();
export type DraftControls = Record<string, z.infer<typeof controlSchema>>;
export const PackageDraftControls = createContext<{
    controls: DraftControls;
    setControl: (key: string, value: DraftControls[string]) => void;
} | null>(null);

const snapshotSchema = z.object({
    values: valuesSchema,
    controls: z.record(z.string().regex(/^[a-zA-Z0-9:_-]{1,100}$/), controlSchema),
}).strict().superRefine((snapshot, ctx) => {
    for (const [key, control] of Object.entries(snapshot.controls)) {
        const units = key === 'sessionLength'
            ? ['minutes', 'hours', 'days', 'weeks', 'months']
            : key.startsWith('audience:')
                ? ['1', '60', '3600', '86400', '1024', '1048576', '1073741824', '1099511627776']
                : ['kbps', 'mbps', 'gbps', 'tbps', 'kb', 'mb', 'gb', 'tb'];
        if (!units.includes(control.unit)) ctx.addIssue({ code: 'custom', path: ['controls', key], message: 'Invalid control unit' });
    }
});
const recordSchema = z.object({
    version: z.literal(1),
    owner: z.string(),
    scope: z.string(),
    savedAt: z.number().finite().positive(),
    baseline: z.string(),
    snapshot: snapshotSchema,
}).strict();

export function parsePackageDraft(raw: string, owner: string, scope: string) {
    if (raw.length > 2_000_000) throw new Error('Draft is too large');
    const record = recordSchema.parse(JSON.parse(raw));
    if (record.owner !== owner || record.scope !== scope) throw new Error('Wrong draft scope');
    return record;
}

function serialize(value: unknown) {
    return JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
        ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]])) : entry);
}

export function usePackageDraft({ owner, scope, baseline, snapshot, onRestore }: {
    owner: string;
    scope: string;
    baseline: string | null;
    snapshot: { values: unknown; controls: DraftControls };
    onRestore: (snapshot: { values: unknown; controls: DraftControls }) => void;
}) {
    const key = `radii:package-draft:v1:${encodeURIComponent(owner)}:${encodeURIComponent(scope)}`;
    const [ready, setReady] = useState(false);
    const [restored, setRestored] = useState(false);
    const [conflict, setConflict] = useState(false);
    const [status, setStatus] = useState('No device draft yet');
    const last = useRef('');
    const originalBaseline = useRef(baseline);
    const stopped = useRef(false);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const latest = useRef({ key, owner, scope, baseline, snapshot });
    const serialized = serialize(snapshot);
    const restore = useEffectEvent(onRestore);

    useEffect(() => {
        if (baseline === null) return;
        originalBaseline.current = baseline;
        last.current = serialized;
        try {
            const raw = localStorage.getItem(key);
            if (raw) {
                const record = parsePackageDraft(raw, owner, scope);
                restore(record.snapshot);
                last.current = serialize(record.snapshot);
                originalBaseline.current = record.baseline;
                setRestored(true);
                setConflict(record.baseline !== baseline);
                setStatus('Draft saved on this device');
            }
        } catch {
            setStatus('Device draft unavailable or invalid. Editing and explicit save still work.');
        }
        setReady(true);
        // This editor is keyed by owner/scope and hydrates exactly once.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [baseline]);

    const write = () => {
        clearTimeout(timer.current);
        const current = latest.current;
        const text = serialize(current.snapshot);
        if (stopped.current || current.baseline === null || text === last.current) return;
        try {
            localStorage.setItem(current.key, JSON.stringify({
                version: 1, owner: current.owner, scope: current.scope,
                baseline: originalBaseline.current, savedAt: Date.now(), snapshot: current.snapshot,
            }));
            last.current = text;
            setStatus('Draft saved on this device');
        } catch {
            setStatus('Could not save device draft. Keep this page open or explicitly save.');
        }
    };
    useEffect(() => {
        latest.current = { key, owner, scope, baseline, snapshot };
        if (!ready || stopped.current || serialized === last.current) return;
        setStatus('Saving draft');
        timer.current = setTimeout(write, 600);
        return () => clearTimeout(timer.current);
        // Serialized data, not object identity, drives the debounce.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [serialized, ready, baseline, key, owner, scope]);

    useEffect(() => {
        const flush = () => { if (ready) write(); };
        window.addEventListener('pagehide', flush);
        return () => {
            window.removeEventListener('pagehide', flush);
            clearTimeout(timer.current);
            flush();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready]);

    const clear = (confirmedSnapshot?: { values: unknown; controls: DraftControls }) => {
        // A completed request may outlive this editor. Do not delete newer
        // edits from a reopened editor (or edits made while the request ran).
        if (confirmedSnapshot && serialize(latest.current.snapshot) !== serialize(confirmedSnapshot)) {
            write();
            stopped.current = true;
            return true;
        }
        stopped.current = true;
        clearTimeout(timer.current);
        try {
            if (confirmedSnapshot) {
                const raw = localStorage.getItem(key);
                if (raw && serialize(JSON.parse(raw).snapshot) !== serialize(confirmedSnapshot)) return true;
            }
            localStorage.removeItem(key);
            return true;
        } catch {
            setStatus('Could not remove device draft. It may reappear after reload.');
            return false;
        }
    };
    return { ready, restored, conflict, status, clear, flush: write };
}
