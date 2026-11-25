import { MdMessage, MdPayment, MdRouter, MdSettings } from 'react-icons/md';

export const settingsCategories = [
    {
        id: 'general',
        label: 'General',
        icon: MdSettings,
        description: 'Manage appearance, dashboard defaults, and support contacts.',
    },
    {
        id: 'packages',
        label: 'Packages & PPPoE',
        icon: MdRouter,
        description: 'Manage package validity, connection fees, PPPoE self-service, and expiry reminders.',
    },
    {
        id: 'payments',
        label: 'Payments',
        icon: MdPayment,
        description: 'Manage payment credentials and transaction settings.',
    },
    {
        id: 'messaging',
        label: 'Messaging',
        icon: MdMessage,
        description: 'Manage WhatsApp configuration and sending protection.',
    },
] as const;
