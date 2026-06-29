import { useForm } from '@mantine/form';
import { zodResolver } from 'mantine-form-zod-resolver';
import { TextInput, PasswordInput, Button, Paper, Title, Container, Stack, Text, Anchor } from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import { signUpSchema } from '@shared/schemas/auth';
import { authClient } from '../lib/auth-client';

export default function Signup() {
    const navigate = useNavigate();
    const form = useForm({
        mode: 'uncontrolled',
        validate: zodResolver(signUpSchema),
        initialValues: { name: '', email: '', password: '' },
    });

    const handleSubmit = async (values: typeof form.values) => {
        const { error } = await authClient.signUp.email({
            name: values.name,
            email: values.email,
            password: values.password,
        });
        if (error) {
            form.setErrors({ email: error.message });
        } else {
            navigate('/login');
        }
    };

    return (
        <Container size={420} my={40}>
            <Title ta="center">Create an account</Title>
            <Text c="dimmed" size="sm" ta="center" mt={5}>
                Already have an account?{' '}
                <Anchor component={Link} to="/login" size="sm">
                    Sign in
                </Anchor>
            </Text>
            <Paper withBorder shadow="md" p={30} mt={30} radius="md">
                <form onSubmit={form.onSubmit(handleSubmit)}>
                    <Stack>
                        <TextInput
                            label="Name"
                            placeholder="Your name"
                            {...form.getInputProps('name')}
                        />
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
                            Sign up
                        </Button>
                    </Stack>
                </form>
            </Paper>
        </Container>
    );
}
