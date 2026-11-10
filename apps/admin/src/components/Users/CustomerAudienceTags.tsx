import { Button, Stack, Text, Textarea } from '@mantine/core';
import { useEffect, useState } from 'react';
import { request } from '@/lib/api';
import { notifyResult } from '@/lib/notify';

export function CustomerAudienceTags({ userId }: { userId: string }) {
    const [value, setValue] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void request<{ tags: string[] }>(`/admin/users/${encodeURIComponent(userId)}/audience-tags`).then((result) => {
            if (cancelled) return;
            if (result.success && result.data) {
                setValue(result.data.tags.join('\n'));
            } else {
                setError(result.success ? 'Could not load audience tags.' : result.message);
            }
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, [userId]);

    const tags = [...new Set(value.split('\n').map((tag) => tag.trim()).filter(Boolean))];
    const invalid = tags.length > 50 || tags.some((tag) => tag.length > 64);
    const save = async () => {
        setSaving(true);
        const result = await request<{ tags: string[] }>(
            `/admin/users/${encodeURIComponent(userId)}/audience-tags`,
            { tags },
            { method: 'PUT' },
        );
        setSaving(false);
        notifyResult(result, 'Audience tags saved');
        if (result.success && result.data) setValue(result.data.tags.join('\n'));
    };

    return (
        <Stack gap='xs'>
            <Textarea
                label='Package audience tags'
                description='One tag per line, for example student, business, or VIP. Tags belong only to your provider and match package audience rules exactly.'
                descriptionProps={{ pb: 'xs' }}
                pb='xs'
                value={value}
                onChange={(event) => setValue(event.currentTarget.value)}
                disabled={loading || saving || error !== null}
                minRows={3}
                autosize
                error={invalid ? 'Use at most 50 tags, each up to 64 characters.' : undefined}
            />
            {error ? <Text size='sm' c='red' role='alert'>{error}</Text> : null}
            <Button variant='light' onClick={() => void save()} loading={saving} disabled={loading || invalid || error !== null}>
                Save audience tags
            </Button>
        </Stack>
    );
}
