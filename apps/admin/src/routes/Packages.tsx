import { Container, Title, Text, Paper, Stack } from '@mantine/core';

export default function Packages() {
  return (
    <Container size="lg" py="xl">
      <Title order={2} mb="md">Packages</Title>
      <Paper withBorder shadow="sm" p="md">
        <Stack>
          <Text c="dimmed">Package management will be implemented here.</Text>
        </Stack>
      </Paper>
    </Container>
  );
}
