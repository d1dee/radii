import { Group, Input, NumberInput, Select } from '@mantine/core';
import { useId } from 'react';

export const BANDWIDTH_UNITS = [
    { value: 'mbps', label: 'Mbps', multiplier: 1_000 },
    { value: 'kbps', label: 'Kbps', multiplier: 1 },
    { value: 'gbps', label: 'Gbps', multiplier: 1_000_000 },
    { value: 'tbps', label: 'Tbps', multiplier: 1_000_000_000 },
];

export function bandwidthKbps(value: number | string, multiplier: number) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return null;
    }
    const rate = Math.round(value * multiplier);
    return Number.isSafeInteger(rate) &&
        rate <= 2_147_483_647 &&
        (value === 0 || rate >= 1)
        ? rate
        : null;
}

export function BandwidthInput({
    label,
    value,
    unit,
    disabled,
    onChange,
    onUnitChange,
}: {
    label: string;
    value: number | string;
    unit: string;
    disabled: boolean;
    onChange: (value: number | string) => void;
    onUnitChange: (unit: string) => void;
}) {
    const id = useId();
    return (
        <Input.Wrapper
            pb='xs'
            id={id}
            label={label}
            description='0 = unlimited'
            descriptionProps={{ pb: 'xs' }}
        >
            <Group gap='xs' wrap='nowrap'>
                <NumberInput
                    id={id}
                    aria-label={label}
                    aria-describedby={`${id}-description`}
                    value={value}
                    onChange={onChange}
                    min={0}
                    step={1}
                    allowNegative={false}
                    disabled={disabled}
                    style={{ flex: 1, minWidth: 0 }}
                />
                <Select
                    aria-label={`${label} unit`}
                    data={BANDWIDTH_UNITS}
                    value={unit}
                    onChange={(next) => {
                        if (next) onUnitChange(next);
                    }}
                    allowDeselect={false}
                    disabled={disabled}
                    w={110}
                    style={{ flexShrink: 0 }}
                />
            </Group>
        </Input.Wrapper>
    );
}
