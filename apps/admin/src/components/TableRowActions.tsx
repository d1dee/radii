import {
    ActionIcon,
    Group,
    Loader,
    Menu,
    Tooltip,
    type MantineColor,
} from '@mantine/core';
import type { ReactNode } from 'react';
import { MdMoreVert } from 'react-icons/md';

export type TableRowAction = {
    label: string;
    ariaLabel?: string;
    icon: ReactNode;
    onClick: () => void;
    color?: MantineColor;
    disabled?: boolean;
    loading?: boolean;
};

export function TableRowActions({
    actions,
    gap = 4,
}: {
    actions: TableRowAction[];
    gap?: number | 'xs';
}) {
    if (actions.length === 0) return null;

    return (
        <>
            <Group justify='flex-end' gap={gap} wrap='nowrap' visibleFrom='md'>
                {actions.map((action) => (
                    <Tooltip key={action.label} label={action.label}>
                        <ActionIcon
                            variant='light'
                            color={action.color}
                            aria-label={action.ariaLabel ?? action.label}
                            disabled={action.disabled}
                            loading={action.loading}
                            onClick={(event) => {
                                event.stopPropagation();
                                action.onClick();
                            }}
                        >
                            {action.icon}
                        </ActionIcon>
                    </Tooltip>
                ))}
            </Group>
            <Menu position='bottom-end' shadow='md' width={240} withinPortal>
                <Menu.Target>
                    <ActionIcon
                        hiddenFrom='md'
                        display='flex'
                        mx='auto'
                        variant='light'
                        color='gray'
                        aria-label='Row actions'
                        onClick={(event) => event.stopPropagation()}
                    >
                        <MdMoreVert size={20} />
                    </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown onClick={(event) => event.stopPropagation()}>
                    {actions.map((action) => (
                        <Menu.Item
                            key={action.label}
                            color={action.color}
                            leftSection={
                                action.loading ? <Loader size={16} /> : action.icon
                            }
                            disabled={action.disabled || action.loading}
                            onClick={(event) => {
                                event.stopPropagation();
                                action.onClick();
                            }}
                        >
                            {action.label}
                        </Menu.Item>
                    ))}
                </Menu.Dropdown>
            </Menu>
        </>
    );
}
