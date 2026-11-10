import { Alert, Button, Group, Modal, Select, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { createPackageAudienceSchema, type PackageAudienceConditions } from '@shared/index';
import { useEffect, useState } from 'react';

import { createPackageAudience, deletePackageAudience, getPackageAudiences, updatePackageAudience, type PackageAudienceRow } from '@/lib/api';
import { fuseOptionsFilter } from '@/lib/fuseOptionsFilter';
import { EligibilityBuilder, type EligibilityBuilderProps } from './EligibilityBuilder';

export function PackageAudienceSelect({ value, onChange, packageOptions, categoryOptions, customers }: {
    value: string | null;
    onChange: (id: string | null) => void;
} & Pick<EligibilityBuilderProps, 'packageOptions' | 'categoryOptions' | 'customers'>) {
    const [audiences, setAudiences] = useState<PackageAudienceRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [opened, setOpened] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [conditions, setConditions] = useState<PackageAudienceConditions>({ mode: 'all', rules: [] });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const load = async () => {
        setLoading(true);
        const result = await getPackageAudiences();
        if (result.success && result.data) {
            setAudiences(result.data.audiences);
            setLoadError(null);
        } else {
            setLoadError(result.success ? 'Could not load audiences.' : result.message);
        }
        setLoading(false);
    };
    useEffect(() => { void load(); }, []);

    const edit = (audience?: PackageAudienceRow) => {
        setEditingId(audience?.id ?? null);
        setName(audience?.name ?? '');
        setDescription(audience?.description ?? '');
        setConditions(structuredClone(audience?.conditions ?? { mode: 'all', rules: [] }));
        setError(null);
        setConfirmDelete(false);
        setOpened(true);
    };
    const save = async () => {
        const parsed = createPackageAudienceSchema.safeParse({ name, description, conditions });
        if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Review audience rules.');
            return;
        }
        setSaving(true);
        const input = { name: parsed.data.name, description: parsed.data.description ?? undefined, conditions: parsed.data.conditions };
        const result = editingId ? await updatePackageAudience(editingId, input) : await createPackageAudience(input);
        setSaving(false);
        if (!result.success || !result.data) {
            setError(result.success ? 'Could not save audience.' : result.message);
            return;
        }
        const saved = result.data.audience;
        setAudiences((current) => [...current.filter((item) => item.id !== saved.id), saved]);
        onChange(saved.id);
        setOpened(false);
    };
    const remove = async () => {
        if (!editingId) return;
        setSaving(true);
        const result = await deletePackageAudience(editingId);
        setSaving(false);
        if (!result.success) {
            setError(result.message);
            setConfirmDelete(false);
            return;
        }
        setAudiences((current) => current.filter((item) => item.id !== editingId));
        if (value === editingId) onChange(null);
        setOpened(false);
    };
    const selected = audiences.find((item) => item.id === value);
    const options = audiences.map((item) => ({ value: item.id, label: item.name }));
    if (value && !selected) options.push({ value, label: 'Selected audience (not loaded)' });
    return (
        <Stack gap='xs'>
            <Select pb='xs' label='Named audience' description='Optional reusable rules. Customers must also pass the package-specific rules.'
                descriptionProps={{ pb: 'xs' }} placeholder='All customers (no named audience)' clearable searchable
                filter={fuseOptionsFilter} data={options} value={value} onChange={onChange} loading={loading} />
            {selected?.description && <Text size='sm' c='dimmed'>{selected.description}</Text>}
            {loadError && <Alert color='red' title='Audiences unavailable'>{loadError}<Button type='button' variant='subtle' size='xs' onClick={() => void load()}>Retry</Button></Alert>}
            <Group gap='xs'>
                <Button type='button' variant='light' size='xs' onClick={() => edit()}>Create audience</Button>
                <Button type='button' variant='default' size='xs' disabled={!selected} onClick={() => selected && edit(selected)}>Edit selected audience</Button>
            </Group>
            <Modal opened={opened} onClose={() => !saving && setOpened(false)} title={editingId ? 'Edit named audience' : 'Create named audience'}
                size='xl' closeOnClickOutside={!saving} closeOnEscape={!saving} withCloseButton={!saving}>
                <Stack>
                    <Text size='sm' c='dimmed'>Changes apply to every package using this audience. An audience in use cannot be deleted.</Text>
                    <TextInput pb='xs' label='Audience name' description='A reusable name for this customer group, such as New PPPoE customers.' descriptionProps={{ pb: 'xs' }} required maxLength={120} value={name} onChange={(event) => setName(event.currentTarget.value)} />
                    <Textarea pb='xs' label='Description' description='Optional internal explanation of who belongs in this audience.' descriptionProps={{ pb: 'xs' }} maxLength={1000} value={description} onChange={(event) => setDescription(event.currentTarget.value)} />
                    <EligibilityBuilder value={conditions} onChange={setConditions} packageOptions={packageOptions} categoryOptions={categoryOptions} customers={customers} />
                    {error && <Alert color='red' role='alert'>{error}</Alert>}
                    {confirmDelete && <Alert color='orange' title='Delete this audience?'>This cannot be undone. Packages using this audience must be unlinked and saved first.</Alert>}
                    <Group justify='flex-end'>
                        {editingId && <Button type='button' color='red' variant='light' loading={saving} onClick={() => confirmDelete ? void remove() : setConfirmDelete(true)}>{confirmDelete ? 'Confirm delete' : 'Delete audience'}</Button>}
                        <Button type='button' variant='default' disabled={saving} onClick={() => setOpened(false)}>Cancel</Button>
                        <Button type='button' loading={saving} onClick={() => void save()}>Save audience</Button>
                    </Group>
                </Stack>
            </Modal>
        </Stack>
    );
}
