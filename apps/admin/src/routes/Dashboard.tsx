import { useEffect, useState } from 'react';
import { Button, Container, Paper, Title, Text, Stack } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { authClient } from '../lib/auth-client';

export default function Dashboard() {
    const navigate = useNavigate();
    const [user, setUser] = useState<any>(null);

    useEffect(() => {
        authClient.getSession().then(({ data }) => {
            if (!data) {
                navigate('/login');
            } else {
                setUser(data.user);
            }
        });
    }, [navigate]);

    const handleLogout = async () => {
        await authClient.signOut();
        navigate('/login');
    };

    if (!user) return null;

    return (
        <Container size={420} my={40}>
            <Title ta="center">Dashboard</Title>
            <Paper withBorder shadow="md" p={30} mt={30} radius="md">
                <Stack>
                    <Text>Welcome, <strong>{user.name}</strong></Text>
                    <Text size="sm" c="dimmed">Email: {user.email}</Text>
                    <Text size="sm" c="dimmed">Role: {user.role}</Text>
                    <Button onClick={handleLogout} color="red" fullWidth>
                        Sign out
                    </Button>
                </Stack>
            </Paper>
        </Container>
    );
}
