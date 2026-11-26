import {
    ActionIcon,
    Box,
    CheckIcon,
    Combobox,
    Group,
    InputBase,
    ScrollArea,
    Stack,
    Text,
    useCombobox,
    type InputBaseProps,
} from '@mantine/core';
import { useUncontrolled } from '@mantine/hooks';
import {
    AsYouType,
    getCountries,
    parsePhoneNumberFromString,
    type CountryCode,
} from 'libphonenumber-js';
import {
    useEffect,
    useRef,
    useState,
    type ComponentPropsWithoutRef,
} from 'react';
import { MdExpandMore } from 'react-icons/md';

import { useCustomerPicker } from '@/components/Packages/customerPicker';

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
const countryOptions = getCountries().map((code) => ({
    code,
    name: countryNames.of(code) ?? code,
    flag: String.fromCodePoint(
        ...code.split('').map((char) => 127397 + char.charCodeAt(0)),
    ),
}));

function phoneState(value: string, fallback: CountryCode) {
    const phone = parsePhoneNumberFromString(value);
    return {
        country: phone?.country ?? fallback,
        localValue: phone?.country ? phone.formatNational() : '',
    };
}

export type RecipientPhoneInputProps = InputBaseProps &
    Omit<
        ComponentPropsWithoutRef<'input'>,
        keyof InputBaseProps | 'value' | 'defaultValue' | 'onChange'
    > & {
        initialCountryCode?: CountryCode;
        value?: string | null;
        defaultValue?: string;
        onChange: (value: string) => void;
    };

export function RecipientPhoneInput({
    initialCountryCode = 'KE',
    value: controlledValue,
    defaultValue = '',
    onChange,
    disabled,
    readOnly,
    onFocus,
    onClick,
    onBlur,
    onPaste,
    ...props
}: RecipientPhoneInputProps) {
    const [value, setValue] = useUncontrolled({
        value: controlledValue === null ? '' : controlledValue,
        defaultValue,
        onChange,
    });
    const [phone, setPhone] = useState(() =>
        phoneState(value ?? '', initialCountryCode),
    );
    const lastValue = useRef(value ?? '');
    const inputRef = useRef<HTMLInputElement>(null);
    const customers = useCustomerPicker([]);
    const combobox = useCombobox({
        onDropdownClose: () => combobox.resetSelectedOption(),
    });
    const blocked = disabled || readOnly;

    useEffect(() => {
        const next = value ?? '';
        if (next === lastValue.current) return;
        lastValue.current = next;
        setPhone((current) => phoneState(next, current.country));
        customers.setSearchValue(next.replace(/\D/g, ''));
        combobox.resetSelectedOption();
    }, [value]);

    useEffect(() => {
        if (blocked) combobox.closeDropdown();
    }, [blocked]);

    function updateValue(next: string) {
        lastValue.current = next;
        setValue(next);
    }

    return (
        <Combobox
            store={combobox}
            disabled={disabled}
            readOnly={readOnly}
            onOptionSubmit={(id) => {
                const customer = customers.options.find(
                    (option) => option.value === id,
                );
                if (!customer || blocked) return;
                const next = `+${customer.phoneNumber.replace(/\D/g, '')}`;
                setPhone(phoneState(next, phone.country));
                updateValue(next);
                customers.setSearchValue('');
                combobox.closeDropdown();
            }}
        >
            <Combobox.DropdownTarget>
                <Box>
                    <Combobox.EventsTarget
                        ref={inputRef}
                        withExpandedAttribute
                    >
                        <InputBase
                            {...props}
                            disabled={disabled}
                            readOnly={readOnly}
                            type='text'
                            inputMode='text'
                            placeholder='Phone number or customer name'
                            autoComplete='off'
                            leftSectionPointerEvents='all'
                            leftSectionWidth={45}
                            styles={{
                                input: {
                                    paddingLeft: 'calc(45px + var(--mantine-spacing-sm))',
                                },
                                section: {
                                    borderRight: '1px solid var(--mantine-color-default-border)',
                                },
                            }}
                            leftSection={
                                <CountrySelect
                                    country={phone.country}
                                    disabled={blocked}
                                    onOpen={() => combobox.closeDropdown()}
                                    onChange={(country) => {
                                        setPhone({ country, localValue: '' });
                                        updateValue('');
                                        customers.setSearchValue('');
                                        inputRef.current?.focus();
                                    }}
                                />
                            }
                            value={phone.localValue}
                            onPaste={(event) => {
                                onPaste?.(event);
                                if (event.defaultPrevented || blocked) return;
                                const pasted = event.clipboardData
                                    .getData('text')
                                    .trim();
                                if (!pasted.startsWith('+')) return;
                                const parsed = parsePhoneNumberFromString(pasted);
                                if (!parsed?.country) return;
                                event.preventDefault();
                                setPhone(phoneState(parsed.number, phone.country));
                                updateValue(parsed.number);
                                customers.setSearchValue(
                                    parsed.number.replace(/^\+/, ''),
                                );
                                combobox.resetSelectedOption();
                                combobox.openDropdown();
                            }}
                            onChange={(event) => {
                                if (blocked) return;
                                const entered = event.currentTarget.value;
                                const isPhone = /^[+\d\s().-]*$/.test(entered);
                                const formatter = new AsYouType(phone.country);
                                const localValue = isPhone
                                    ? formatter.input(entered)
                                    : entered;
                                setPhone((current) => ({
                                    ...current,
                                    localValue,
                                }));
                                const canonical = isPhone
                                    ? (formatter.getNumber()?.number ?? '')
                                    : '';
                                updateValue(canonical);
                                // Query the digits actually entered, without a national trunk prefix.
                                customers.setSearchValue(
                                    isPhone
                                        ? entered
                                              .replace(/\D/g, '')
                                              .replace(/^0+/, '') ||
                                          canonical.replace(/^\+/, '')
                                        : entered,
                                );
                                combobox.resetSelectedOption();
                                combobox.openDropdown();
                            }}
                            onFocus={(event) => {
                                if (event.target !== event.currentTarget) return;
                                if (!blocked) combobox.openDropdown();
                                onFocus?.(event);
                            }}
                            onClick={(event) => {
                                if (event.target !== event.currentTarget) return;
                                if (!blocked) combobox.openDropdown();
                                onClick?.(event);
                            }}
                            onBlur={(event) => {
                                if (event.target !== event.currentTarget) return;
                                combobox.closeDropdown();
                                onBlur?.(event);
                            }}
                        />
                    </Combobox.EventsTarget>
                </Box>
            </Combobox.DropdownTarget>
            <Combobox.Dropdown>
                <Combobox.Options aria-label='Customer suggestions'>
                    {customers.loading || customers.error ? (
                        <Combobox.Empty>
                            {customers.error ?? 'Searching customers...'}
                        </Combobox.Empty>
                    ) : customers.options.length === 0 ? (
                        <Combobox.Empty>No customers found</Combobox.Empty>
                    ) : (
                        <ScrollArea.Autosize mah={280}>
                            {customers.options.map((customer) => (
                                <Combobox.Option
                                    key={customer.value}
                                    value={customer.value}
                                >
                                    <Stack gap={2} style={{ minWidth: 0 }}>
                                        <Text size='sm' fw={500}>
                                            {customer.internalName ??
                                                'Unnamed customer'}
                                        </Text>
                                        <Text size='xs' c='dimmed'>
                                            {customer.phoneNumber}
                                            {customer.location &&
                                                ` · ${customer.location}`}
                                        </Text>
                                    </Stack>
                                </Combobox.Option>
                            ))}
                        </ScrollArea.Autosize>
                    )}
                </Combobox.Options>
            </Combobox.Dropdown>
        </Combobox>
    );
}

function CountrySelect({
    country,
    disabled,
    onOpen,
    onChange,
}: {
    country: CountryCode;
    disabled?: boolean;
    onOpen: () => void;
    onChange: (country: CountryCode) => void;
}) {
    const [search, setSearch] = useState('');
    const selectedRef = useRef<HTMLDivElement>(null);
    const combobox = useCombobox({
        onDropdownOpen: () => {
            onOpen();
            combobox.focusSearchInput();
            selectedRef.current?.scrollIntoView({ block: 'nearest' });
        },
        onDropdownClose: () => {
            combobox.resetSelectedOption();
            setSearch('');
        },
    });
    const options = countryOptions.filter((option) =>
        `${option.name} ${option.code}`
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
    );
    useEffect(() => {
        combobox.resetSelectedOption();
    }, [search]);

    return (
        <Box
            onKeyDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            <Combobox
                store={combobox}
                disabled={disabled}
                width={250}
                position='bottom-start'
                shadow='md'
                onOptionSubmit={(value) => {
                    combobox.closeDropdown();
                    onChange(value as CountryCode);
                }}
            >
                <Combobox.Target targetType='button'>
                    <ActionIcon
                        type='button'
                        variant='transparent'
                        size='lg'
                        w={45}
                        c='dimmed'
                        disabled={disabled}
                        aria-label={`Select country (${countryOptions.find((option) => option.code === country)?.name})`}
                        onClick={() => combobox.toggleDropdown()}
                    >
                        <Group gap={2} wrap='nowrap'>
                            {countryOptions.find((option) => option.code === country)?.flag}
                            <MdExpandMore size={14} />
                        </Group>
                    </ActionIcon>
                </Combobox.Target>
                <Combobox.Dropdown>
                    <Combobox.Search
                        value={search}
                        onChange={(event) => setSearch(event.currentTarget.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') event.preventDefault();
                        }}
                        placeholder='Search country'
                        aria-label='Search country'
                    />
                    <Combobox.Options>
                        <ScrollArea.Autosize mah={280} type='scroll'>
                            {options.length ? options.map((option) => (
                                <Combobox.Option
                                    key={option.code}
                                    value={option.code}
                                    active={option.code === country}
                                    ref={option.code === country ? selectedRef : undefined}
                                >
                                    <Group gap='xs'>
                                        {option.code === country && <CheckIcon size={12} />}
                                        {option.flag}
                                        <span>{option.name}</span>
                                    </Group>
                                </Combobox.Option>
                            )) : <Combobox.Empty>Nothing found</Combobox.Empty>}
                        </ScrollArea.Autosize>
                    </Combobox.Options>
                </Combobox.Dropdown>
            </Combobox>
        </Box>
    );
}
