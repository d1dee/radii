import { Badge, Card, Group, SimpleGrid, Text, Title } from '@mantine/core';

const stats = [
    { label: 'Total Users', value: '1,245', change: '+12%' },
    { label: 'Active Packages', value: '42', change: '+3' },
    { label: 'Revenue', value: '$8,320', change: '+8%' },
    { label: 'Pending Orders', value: '18', change: '-2' },
];

export default function DashboardPage() {
    return (
        <>
            <Title order={1} mb='md'>
                Dashboard
            </Title>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                {stats.map((stat) => (
                    <Card key={stat.label} shadow='sm' padding='lg' radius='md' withBorder>
                        <Text size='sm' c='dimmed'>
                            {stat.label}
                        </Text>
                        <Group justify='space-between' align='flex-end' mt='md'>
                            <Title order={3}>{stat.value}</Title>
                            <Badge color={stat.change.startsWith('+') ? 'green' : 'red'}>
                                {stat.change}
                            </Badge>
                        </Group>
                    </Card>
                ))}
            </SimpleGrid>
        </>
    );
}
