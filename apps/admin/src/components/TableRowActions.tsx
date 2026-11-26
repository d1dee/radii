import {
    ActionIcon,
    Loader,
    Menu,
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
}: {
    actions: TableRowAction[];
}) {
    if (actions.length === 0) return null;

    return (
        <Menu position='bottom-end' shadow='md' width={240} withinPortal>
            <Menu.Target>
                <ActionIcon
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
                        aria-label={action.ariaLabel ?? action.label}
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
    );
}
