import {
    MdDashboard,
    MdPalette,
    MdPayment,
    MdRouter,
    MdSupportAgent,
    MdWifiTethering,
} from 'react-icons/md';

export const settingsCategories = [
    {
        id: 'appearance',
        label: 'Appearance',
        icon: MdPalette,
        description: 'Customize display, date, time, and currency preferences.',
    },
    {
        id: 'dashboard',
        label: 'Dashboard',
        icon: MdDashboard,
        description: 'Configure refresh intervals and table defaults.',
    },
    {
        id: 'mpesa',
        label: 'M-Pesa',
        icon: MdPayment,
        description: 'Manage payment credentials and transaction settings.',
    },
    {
        id: 'contacts',
        label: 'Support Contacts',
        icon: MdSupportAgent,
        description: 'Set the support contact details shown to customers.',
    },
    {
        id: 'packages',
        label: 'Packages',
        icon: MdRouter,
        description: 'Set the validity window for hotspot time-bank packages.',
    },
    {
        id: 'pppoe',
        label: 'PPPoE',
        icon: MdWifiTethering,
        description: 'Control customer password visibility and self-service.',
    },
] as const;
