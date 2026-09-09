import { Anchor, Card, Flex, Group, Text } from '@mantine/core';

export function Footer() {
    return (
        <footer>
            <Card radius='md'>
                <Flex justify='space-between'>
                    <Text fw={300} size='sm'>
                        Radii PPPoE Systems
                    </Text>
                    <Text fw={300} size='sm'>
                        &copy; {new Date().getFullYear()} Radii. All rights
                        reserved.
                    </Text>
                    <Group>
                        <Anchor
                            href='#'
                            className='hover:underline'
                            fw={300}
                            size='sm'
                        >
                            Privacy Policy
                        </Anchor>
                        <Anchor
                            href='#'
                            className='hover:underline'
                            fw={300}
                            size='sm'
                        >
                            Terms
                        </Anchor>
                        <Anchor
                            href='#'
                            className='hover:underline'
                            fw={300}
                            size='sm'
                        >
                            Contact
                        </Anchor>
                    </Group>
                </Flex>
            </Card>
        </footer>
    );
}
