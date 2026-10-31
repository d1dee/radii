import { Badge } from '@mantine/core';

export function ArchivedPackageBadge({
    archivedAt,
}: {
    archivedAt: string | null;
}) {
    return archivedAt ? (
        <Badge size='xs' color='gray' variant='light'>
            Archived
        </Badge>
    ) : null;
}
