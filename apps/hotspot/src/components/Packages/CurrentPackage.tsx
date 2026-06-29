import { IoMdArrowDown, IoMdArrowUp } from 'react-icons/io';
import { useContext, useEffect } from 'react';
import { checkOnlineStatus, checkQuotaStatus, timeRemaining } from './functions.ts';

import { useSignal } from '../libs/hooks/useSignal.ts';
import humanFormat from 'human-format';
import { StatusQuotas } from '../../../types/index.d.ts';
import { dayjs } from '../../libs/utils/utils.ts';
import { Toast } from '../Alert.tsx';
import { QuotaContext } from '../Main.tsx';
import { ConnectedDevice } from './ConnectedDevices.tsx';
import { dataScale } from './PackagePricing.tsx';

export function CurrentPackage() {
    const onlineStatus = useSignal<{
        state: 'online' | 'offline' | '';
        prevState: 'online' | 'offline' | '';
    }>({ state: '', prevState: '' });
    const statusQuotasSignal = useContext(QuotaContext);

    // Pick the highest if no token belongs to this devices
    const deviceQuota =
        statusQuotasSignal.value?.find((v) => v.thisDevice) ||
        (statusQuotasSignal.value && statusQuotasSignal.value[0]);

    const signal = useSignal<Partial<StatusQuotas[number]> & { width: string }>({
        ...deviceQuota,
        width:
            !deviceQuota?.initialSessionLength || !deviceQuota?.remainingSessionLength
                ? '0%'
                : Math.max(
                      0,
                      Math.min(
                          100,
                          (dayjs
                              .duration(deviceQuota?.remainingSessionLength || 0, 'm')
                              .asSeconds() *
                              100) /
                              dayjs
                                  .duration(deviceQuota?.initialSessionLength || 0, 'm')
                                  .asSeconds(),
                      ),
                  ) + '%',
        remainingSessionLength: dayjs
            .duration(deviceQuota?.remainingSessionLength || 0, 'm')
            .asSeconds(),
        initialSessionLength: dayjs
            .duration(deviceQuota?.initialSessionLength || 0, 'm')
            .asSeconds(),
    });

    /* Run quota status check every 10 seconds */
    useEffect(() => {
        const statusCheck = async () => {
            const statusQuotas = await checkQuotaStatus(signal);
            statusQuotas && (statusQuotasSignal.value = statusQuotas);
        };

        const interval = setInterval(statusCheck, 10e3);

        return () => clearInterval(interval);
    }, []);

    /* Run online status check every 20 seconds */
    useEffect(() => {
        const check = async () => {
            const isOnline = await checkOnlineStatus();

            // update online status
            if (isOnline) {
                onlineStatus.value = { prevState: onlineStatus.value.state, state: 'online' };
            } else {
                onlineStatus.value = { prevState: onlineStatus.value.state, state: 'offline' };
            }
        };
        // use exponensial backoff for online status check and update online status after three attempts
        check();

        // Poll every 20 seconds
        const interval = setInterval(check, 20e3);

        return () => clearInterval(interval);
    }, []);

    const { downloadRate, uploadRate, width, remainingSessionLength, deviceQuotaId } = signal.value;

    return (
        <div className='w-full rounded-2xl bg-white px-4 py-6 shadow-xl'>
            <h3 className='text-lg font-semibold'>Active Package Details</h3>
            <div className='mt-4'>
                <div className='flex items-center justify-between'>
                    <p className='text-sm font-medium'>Time remaining</p>
                    <p className='text-sm font-medium'>
                        {timeRemaining(dayjs.duration(remainingSessionLength || 0, 's'))}
                    </p>
                </div>
                <div className='relative my-2 h-2 rounded-full bg-red-200'>
                    <div
                        className={`absolute left-0 top-0 h-2 rounded-full bg-purple-500`}
                        style={{ width: width }}
                    ></div>
                </div>
                <div className='space-y-2'>
                    <div className='flex items-center justify-between gap-2 text-sm text-gray-500'>
                        <div className='flex items-center'>
                            Devices: {statusQuotasSignal.value?.length || ' _'}
                        </div>
                        <div className='flex items-center'>
                            Package info:{' '}
                            {deviceQuota?.downloadRate
                                ? `${humanFormat(deviceQuota.downloadRate, {
                                      scale: dataScale,
                                  })} - Ksh ${deviceQuota.price.toLocaleString()}`
                                : ' _'}
                        </div>
                        <div className='flex items-center gap-2'>
                            <div className='inline-flex items-center gap-2'>
                                <IoMdArrowDown />
                                <p>
                                    {downloadRate && downloadRate !== 0
                                        ? humanFormat(downloadRate, { scale: dataScale })
                                        : ' _'}
                                </p>
                            </div>
                            <div className='inline-flex items-center gap-2'>
                                <IoMdArrowUp />
                                <p>
                                    {uploadRate && uploadRate !== 0
                                        ? humanFormat(uploadRate, { scale: dataScale })
                                        : ' _'}
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className='flex flex-wrap items-center justify-between gap-2 text-sm text-gray-500'>
                        <div className='flex items-center'>Quota ID: {deviceQuotaId || ' _'}</div>
                        <div className='flex items-center'>
                            Parent Quota: {deviceQuota?.parentQuotaId || ' _'}
                        </div>
                    </div>
                    <ConnectedDevice />
                </div>
            </div>
            {/* <button className="w-full mt-4 border border-gray-300 py-2 rounded-lg text-gray-700 hover:bg-gray-100">
                Sign
            </button> */}
            {onlineStatus.value.state === 'online' ? <OnlineAlert /> : null}

            {onlineStatus.value.state === 'offline' ? (
                <OfflineAlert
                    hasSession={!!(remainingSessionLength && remainingSessionLength > 0)}
                />
            ) : null}
        </div>
    );
}

function OnlineAlert() {
    const msg = (
        <div>
            <h3 className='font-bold'>You are back online.</h3>
            <div className='text-xs'>You can now surf the internet.</div>
        </div>
    );
    return <Toast values={{ message: msg, style: 'alert-soft', type: 'alert-success' }} />;
}

function OfflineAlert({ hasSession }: { hasSession: boolean }) {
    const msg = (
        <div>
            <h3 className='font-bold'>You are offline.</h3>
            {hasSession ? (
                <div className='text-xs'>Turn your wifi off and on again.</div>
            ) : (
                <div className='text-xs'>
                    Purchase one of the packages below to access the internet.
                </div>
            )}
        </div>
    );
    return <Toast values={{ message: msg, style: 'alert-soft', type: 'alert-error' }} />;
}
