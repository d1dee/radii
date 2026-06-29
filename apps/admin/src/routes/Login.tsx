import { useForm } from '@mantine/form';
import { zodResolver } from 'mantine-form-zod-resolver';
import { TextInput, PasswordInput, Button, Paper, Title, Container, Stack, Text, Anchor } from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import { loginSchema } from '@shared/schemas/auth';
import { authClient } from '../lib/auth-client';

export default function Login() {
    const navigate = useNavigate();
    const form = useForm({
        mode: 'uncontrolled',
        validate: zodResolver(loginSchema),
        initialValues: { email: '', password: '' },
    });

    const handleSubmit = async (values: typeof form.values) => {
        const { error } = await authClient.signIn.email({
            email: values.email,
            password: values.password,
        });
        if (error) {
            form.setErrors({ email: error.message });
        } else {
            navigate('/dashboard');
        }
    };

    return (
        <Container size={420} my={40}>
            <Title ta="center">Welcome back</Title>
            <Text c="dimmed" size="sm" ta="center" mt={5}>
                Don't have an account?{' '}
                <Anchor component={Link} to="/signup" size="sm">
                    Sign up
                </Anchor>
            </Text>
            <Paper withBorder shadow="md" p={30} mt={30} radius="md">
                <form onSubmit={form.onSubmit(handleSubmit)}>
                    <Stack>
                        <TextInput
                            label="Email"
                            placeholder="you@example.com"
                            {...form.getInputProps('email')}
                        />
                        <PasswordInput
                            label="Password"
                            placeholder="Your password"
                            {...form.getInputProps('password')}
                        />
                        <Button type="submit" fullWidth>
                            Sign in
                        </Button>
                    </Stack>
                </form>
            </Paper>
        </Container>
    );
}
