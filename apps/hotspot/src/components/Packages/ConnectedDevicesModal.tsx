import { useContext, useEffect } from "react";
import fetch from 'better-fetch';

import { FaSpinner } from "react-icons/fa";
import { useSignal } from "../libs/hooks/useSignal.ts";
import humanFormat from "human-format";
import { dayjs } from "../../libs/utils/utils.ts";
import { QuotaContext } from "../Main.tsx";
import Modal from "../Modal.tsx";
import { timeRemaining } from "./functions.ts";
import { dataScale } from "./PackagePricing.tsx";

export function ConnectedDevicesModal() {
    const statusQuotasSignal = useContext(QuotaContext);
    const deviceId = useSignal<string>("");
    const pendingDeauth = useSignal<Array<string>>([]);

    useEffect(() => {
        const deauth = async () => {
            if (deviceId.value) {
                pendingDeauth.value = [...pendingDeauth.value, deviceId.value];
                const params = new URLSearchParams(location.search);
                params.set("deauth", deviceId.value);

                const res = await fetch(`nds?${params.toString()}`, {
                    method: "get",
                });
            }
        };
        deauth();
    }, [deviceId.value]);

    return (
        <Modal>
            <div className="space-y-4">
                <div className="space-y-2">
                    <h3 className="text-xl font-bold ">Connected Devices</h3>
                    <p className="text-sm text-slate-500 font-extralight">
                        Manage your connected devices below.
                    </p>
                </div>
                <div className="overflow-auto mt-4">
                    <table className="table table-sm">
                        <thead>
                            <tr>
                                <th>S/N</th>
                                <th>Device</th>
                                <th>Package</th>
                                <th>Time Left</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {statusQuotasSignal.value?.toSorted((v) => v.thisDevice ? -1 : 1).map(
                                (v, i) => {
                                    return (
                                        <tr
                                            key={v.deviceQuotaId}
                                            className={v.thisDevice ? "bg-purple-50" : ""}
                                        >
                                            <td>{i + 1}</td>
                                            <td>
                                                <div>
                                                    <p>{v.deviceQuotaId}</p>
                                                    <p className="font-thin text-xs opacity-50">
                                                        {v.clientMac}
                                                    </p>
                                                </div>
                                            </td>
                                            <td>
                                                <div>
                                                    <p className="text-wrap">
                                                        {humanFormat(v.downloadRate, {
                                                            scale: dataScale,
                                                        })} - Ksh {v.price.toLocaleString()}
                                                    </p>
                                                    <p className="font-thin text-xs opacity-50">
                                                        {v.parentQuotaId}
                                                    </p>
                                                </div>
                                            </td>
                                            <td className="text-wrap max-w-[130px]">
                                                {timeRemaining(
                                                    dayjs.duration(
                                                        v.remainingSessionLength || 0,
                                                        "m",
                                                    ),
                                                )}
                                            </td>
                                            <td>
                                                {!pendingDeauth.value?.includes(v.deviceQuotaId)
                                                    ? (
                                                        <button
                                                            className="link link-error btn-link underline-offset-2"
                                                            onClick={() =>
                                                                deviceId.value = v.deviceQuotaId}
                                                        >
                                                            Disconnect
                                                        </button>
                                                    )
                                                    : (
                                                        <div className=" items-center text-error cursor-wait">
                                                            <FaSpinner className="animate-spin" />
                                                        </div>
                                                    )}
                                            </td>
                                        </tr>
                                    );
                                },
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </Modal>
    );
}
