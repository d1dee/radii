import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    type DragEndEvent,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    SortableContext,
    arrayMove,
    rectSortingStrategy,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    ActionIcon,
    Alert,
    Badge,
    Button,
    Card,
    Center,
    Group,
    Loader,
    Paper,
    SegmentedControl,
    Select,
    SimpleGrid,
    Stack,
    Text,
    Title,
} from '@mantine/core';
import { upperFirstCase } from '@radii/shared';
import { useEffect, useState } from 'react';
import { MdArrowBack, MdDragIndicator, MdSave } from 'react-icons/md';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { PageLayout } from '@/components/Layout/PageLayout';
import {
    getAllAdminPackages,
    getAllNasDevices,
    savePackageLayout,
    type NasDeviceRow,
    type PackageRow,
    type PackageType,
} from '@/lib/api';
import { formatPackagePrice, formatPackageRate, formatSeconds } from '@/lib/format';
import { notifyResult } from '@/lib/notify';

type LayoutCategory = {
    name: string;
    packages: PackageRow[];
};

const CATEGORY_PREFIX = 'category:';
const PACKAGE_PREFIX = 'package:';

function categoryId(name: string) {
    return `${CATEGORY_PREFIX}${name}`;
}

function packageId(id: string) {
    return `${PACKAGE_PREFIX}${id}`;
}

function compareNullableOrder(
    a: number | null,
    b: number | null,
    fallback: () => number,
) {
    if (a !== null && b !== null && a !== b) return a - b;
    if (a !== null) return -1;
    if (b !== null) return 1;
    return fallback();
}

function buildLayout(packages: PackageRow[]): LayoutCategory[] {
    const grouped = new Map<string, PackageRow[]>();
    for (const pkg of packages) {
        const categoryPackages = grouped.get(pkg.category) ?? [];
        categoryPackages.push(pkg);
        grouped.set(pkg.category, categoryPackages);
    }

    return [...grouped.entries()]
        .map(([name, categoryPackages]) => ({
            name,
            packages: categoryPackages.toSorted((a, b) =>
                compareNullableOrder(a.sortOrder, b.sortOrder, () =>
                    a.title.localeCompare(b.title),
                ),
            ),
        }))
        .toSorted((a, b) =>
            compareNullableOrder(
                a.packages[0]?.categorySortOrder ?? null,
                b.packages[0]?.categorySortOrder ?? null,
                () => a.name.localeCompare(b.name),
            ),
        );
}

function SortableCategory({
    name,
    active,
    count,
    onSelect,
}: {
    name: string;
    active: boolean;
    count: number;
    onSelect: () => void;
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
        isOver,
    } = useSortable({ id: categoryId(name) });

    return (
        <Button
            ref={setNodeRef}
            variant={active ? 'filled' : 'light'}
            leftSection={<MdDragIndicator />}
            rightSection={
                <Badge size='xs' variant={active ? 'white' : 'light'}>
                    {count}
                </Badge>
            }
            onClick={onSelect}
            style={{
                transform: CSS.Transform.toString(transform),
                transition,
                opacity: isDragging ? 0.55 : 1,
                touchAction: 'none',
                outline: isOver && !isDragging
                    ? '2px solid var(--mantine-primary-color-filled)'
                    : undefined,
                outlineOffset: 3,
            }}
            {...attributes}
            {...listeners}
        >
            {upperFirstCase(name)}
        </Button>
    );
}

function SortablePackageCard({ pkg }: { pkg: PackageRow }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
        isOver,
    } = useSortable({ id: packageId(pkg.id) });

    return (
        <Card
            ref={setNodeRef}
            shadow='sm'
            radius='lg'
            withBorder
            style={{
                transform: CSS.Transform.toString(transform),
                transition,
                opacity: isDragging ? 0.55 : 1,
                position: 'relative',
                zIndex: isDragging ? 2 : undefined,
                outline: isOver && !isDragging
                    ? '2px solid var(--mantine-primary-color-filled)'
                    : undefined,
                outlineOffset: 3,
            }}
        >
            <Stack gap='md'>
                <Group justify='space-between' align='flex-start' wrap='nowrap'>
                    <Stack gap='xs' miw={0}>
                        <Group gap='xs' wrap='nowrap'>
                            <ActionIcon
                                variant='subtle'
                                color='gray'
                                aria-label={`Drag ${pkg.title} to reorder or move it to another category`}
                                style={{ touchAction: 'none', flexShrink: 0 }}
                                {...attributes}
                                {...listeners}
                            >
                                <MdDragIndicator />
                            </ActionIcon>
                            <Text c='dimmed' truncate>
                                {upperFirstCase(pkg.title)}
                            </Text>
                        </Group>
                        <Text size='32px' fw={700}>
                            {formatPackageRate(pkg.downloadRate)}
                        </Text>
                    </Stack>
                    <Stack gap='xs' align='flex-end' style={{ flexShrink: 0 }}>
                        <Text size='sm' c='dimmed'>
                            {pkg.noExpiry
                                ? 'Unlimited'
                                : formatSeconds(pkg.sessionLength * 60)}
                        </Text>
                        <Text size='xl' fw={700}>
                            {formatPackagePrice(pkg.price)}
                        </Text>
                    </Stack>
                </Group>
                <Button fullWidth disabled>
                    {Number(pkg.price) === 0 ? 'Activate' : 'Buy Now'}
                </Button>
            </Stack>
        </Card>
    );
}

export default function PackagePortalPage() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const initialType = searchParams.get('type');
    const [type, setType] = useState<PackageType>(
        initialType === 'pppoe' ? 'pppoe' : 'hotspot',
    );
    const [layout, setLayout] = useState<LayoutCategory[]>([]);
    const [nasDevices, setNasDevices] = useState<NasDeviceRow[]>([]);
    const [nasDeviceId, setNasDeviceId] = useState<string | null>(null);
    const [selectedCategory, setSelectedCategory] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        }),
    );

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError(null);
        void Promise.all([
            getAllAdminPackages({ type, archived: 'current' }),
            getAllNasDevices(),
        ]).then(([packagesResult, nasResult]) => {
            if (!active) return;
            setLoading(false);
            if (!packagesResult.success || !packagesResult.data) {
                setError(
                    packagesResult.success
                        ? 'Failed to load packages'
                        : packagesResult.message,
                );
                return;
            }
            if (!nasResult.success || !nasResult.data) {
                setError(
                    nasResult.success
                        ? 'Failed to load NAS devices'
                        : nasResult.message,
                );
                return;
            }
            const nextLayout = buildLayout(packagesResult.data);
            setLayout(nextLayout);
            setNasDevices(nasResult.data);
            setSelectedCategory(nextLayout[0]?.name ?? '');
            setDirty(false);
        });
        return () => {
            active = false;
        };
    }, [type]);

    const canvasLayout = layout
        .map((category) => ({
            ...category,
            packages:
                nasDeviceId === null
                    ? category.packages
                    : category.packages.filter(
                          (pkg) =>
                              pkg.isActive &&
                              pkg.nasDeviceIds.includes(nasDeviceId),
                      ),
        }))
        .filter((category) => category.packages.length > 0);
    const activeCategory =
        canvasLayout.find((category) => category.name === selectedCategory) ??
        canvasLayout[0];

    const handleDragEnd = ({ active, over }: DragEndEvent) => {
        if (!over || active.id === over.id) return;
        const activeValue = String(active.id);
        const overValue = String(over.id);

        if (
            activeValue.startsWith(CATEGORY_PREFIX) &&
            overValue.startsWith(CATEGORY_PREFIX)
        ) {
            const activeName = activeValue.slice(CATEGORY_PREFIX.length);
            const overName = overValue.slice(CATEGORY_PREFIX.length);
            setLayout((current) => {
                const oldIndex = current.findIndex(
                    (category) => category.name === activeName,
                );
                const newIndex = current.findIndex(
                    (category) => category.name === overName,
                );
                return oldIndex >= 0 && newIndex >= 0
                    ? arrayMove(current, oldIndex, newIndex)
                    : current;
            });
            setDirty(true);
            return;
        }

        if (!activeValue.startsWith(PACKAGE_PREFIX)) return;
        const activePackageId = activeValue.slice(PACKAGE_PREFIX.length);
        const targetCategoryName = overValue.startsWith(CATEGORY_PREFIX)
            ? overValue.slice(CATEGORY_PREFIX.length)
            : layout.find((category) =>
                  category.packages.some(
                      (pkg) =>
                          pkg.id === overValue.slice(PACKAGE_PREFIX.length),
                  ),
              )?.name;
        setLayout((current) => {
            const sourceCategory = current.find((category) =>
                category.packages.some((pkg) => pkg.id === activePackageId),
            );
            const targetCategory = overValue.startsWith(CATEGORY_PREFIX)
                ? current.find(
                      (category) =>
                          category.name ===
                          overValue.slice(CATEGORY_PREFIX.length),
                  )
                : current.find((category) =>
                      category.packages.some(
                          (pkg) =>
                              pkg.id === overValue.slice(PACKAGE_PREFIX.length),
                      ),
                  );
            if (!sourceCategory || !targetCategory) return current;

            const sourcePackageIndex = sourceCategory.packages.findIndex(
                (pkg) => pkg.id === activePackageId,
            );
            const targetPackageIndex = overValue.startsWith(PACKAGE_PREFIX)
                ? targetCategory.packages.findIndex(
                      (pkg) =>
                          pkg.id === overValue.slice(PACKAGE_PREFIX.length),
                  )
                : targetCategory.packages.length;

            if (sourceCategory.name === targetCategory.name) {
                if (targetPackageIndex < 0) return current;
                return current.map((category) =>
                    category.name === sourceCategory.name
                        ? {
                              ...category,
                              packages: arrayMove(
                                  category.packages,
                                  sourcePackageIndex,
                                  Math.min(
                                      targetPackageIndex,
                                      category.packages.length - 1,
                                  ),
                              ),
                          }
                        : category,
                );
            }

            const movedPackage = {
                ...sourceCategory.packages[sourcePackageIndex],
                category: targetCategory.name,
            };
            const next = current
                .map((category) => {
                    if (category.name === sourceCategory.name) {
                        return {
                            ...category,
                            packages: category.packages.filter(
                                (pkg) => pkg.id !== activePackageId,
                            ),
                        };
                    }
                    if (category.name === targetCategory.name) {
                        const packages = [...category.packages];
                        packages.splice(targetPackageIndex, 0, movedPackage);
                        return { ...category, packages };
                    }
                    return category;
                })
                .filter((category) => category.packages.length > 0);
            return next;
        });
        if (targetCategoryName) setSelectedCategory(targetCategoryName);
        setDirty(true);
    };

    const handleSave = async () => {
        setSaving(true);
        const result = await savePackageLayout({
            type,
            categories: layout.map((category) => ({
                name: category.name,
                packageIds: category.packages.map((pkg) => pkg.id),
            })),
        });
        setSaving(false);
        notifyResult(result, 'Portal package layout saved');
        if (result.success) setDirty(false);
    };

    return (
        <PageLayout
            label='Package portal editor'
            header={
                <Group justify='space-between' align='flex-start'>
                    <Group align='flex-start'>
                        <ActionIcon
                            variant='subtle'
                            size='lg'
                            aria-label='Back to packages'
                            onClick={() => navigate('/packages')}
                        >
                            <MdArrowBack />
                        </ActionIcon>
                        <Stack gap={4}>
                            <Title order={3}>Package portal</Title>
                            <Text size='sm' c='dimmed'>
                                Drag the portal tabs and package cards into the
                                order customers should see.
                            </Text>
                        </Stack>
                    </Group>
                    <Button
                        leftSection={<MdSave />}
                        loading={saving}
                        disabled={!dirty || loading || layout.length === 0}
                        onClick={handleSave}
                    >
                        Save layout
                    </Button>
                </Group>
            }
        >
            <Group justify='space-between' align='flex-end'>
                <SegmentedControl
                    value={type}
                    onChange={(value) => {
                        const nextType = value as PackageType;
                        setType(nextType);
                        setSearchParams({ type: nextType }, { replace: true });
                    }}
                    data={[
                        { value: 'hotspot', label: 'Hotspot' },
                        { value: 'pppoe', label: 'PPPoE' },
                    ]}
                />
                <Select
                    label='Preview NAS'
                    description='Clear to arrange every package'
                    placeholder='All packages'
                    value={nasDeviceId}
                    onChange={setNasDeviceId}
                    data={nasDevices.map((device) => ({
                        value: device.id,
                        label: device.name,
                    }))}
                    searchable
                    clearable
                    nothingFoundMessage='No NAS devices found'
                    w={{ base: '100%', sm: 280 }}
                />
            </Group>

            {loading ? (
                <Center py='xl'>
                    <Loader />
                </Center>
            ) : error ? (
                <Alert color='red' title='Could not load portal editor'>
                    {error}
                </Alert>
            ) : layout.length === 0 ? (
                <Alert color='blue' title={`No ${type} packages`}>
                    Add packages before arranging this portal.
                </Alert>
            ) : (
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                >
                    <Paper shadow='xl' radius='lg' p='lg' withBorder>
                        <Stack gap='md'>
                            <Group justify='space-between'>
                                <div>
                                    <Text size='lg' fw={600}>
                                        Available Packages
                                    </Text>
                                    <Text size='sm' c='dimmed'>
                                        Drag tabs to reorder categories. Drag a
                                        card within the list or onto another tab.
                                    </Text>
                                </div>
                                {dirty ? (
                                    <Badge color='orange'>Unsaved changes</Badge>
                                ) : null}
                            </Group>

                            {canvasLayout.length === 0 ? (
                                <Alert color='blue' title='No packages available'>
                                    No {type} packages are linked to this NAS.
                                </Alert>
                            ) : (
                                <>
                                    <SortableContext
                                        items={canvasLayout.map((category) =>
                                            categoryId(category.name),
                                        )}
                                        strategy={rectSortingStrategy}
                                    >
                                        <SimpleGrid
                                            cols={{ base: 2, xs: 3, md: 5 }}
                                            spacing='md'
                                        >
                                            {canvasLayout.map((category) => (
                                                <SortableCategory
                                                    key={category.name}
                                                    name={category.name}
                                                    count={category.packages.length}
                                                    active={
                                                        category.name ===
                                                        activeCategory?.name
                                                    }
                                                    onSelect={() =>
                                                        setSelectedCategory(
                                                            category.name,
                                                        )
                                                    }
                                                />
                                            ))}
                                        </SimpleGrid>
                                    </SortableContext>

                                    <SortableContext
                                        items={
                                            activeCategory?.packages.map((pkg) =>
                                                packageId(pkg.id),
                                            ) ?? []
                                        }
                                        strategy={verticalListSortingStrategy}
                                    >
                                        <Stack gap='md'>
                                            {activeCategory?.packages.map((pkg) => (
                                                <SortablePackageCard
                                                    key={pkg.id}
                                                    pkg={pkg}
                                                />
                                            ))}
                                        </Stack>
                                    </SortableContext>
                                </>
                            )}
                        </Stack>
                    </Paper>
                </DndContext>
            )}
        </PageLayout>
    );
}
