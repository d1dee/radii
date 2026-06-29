import { AiOutlineCheckCircle, AiOutlineExclamationCircle } from "react-icons/ai";
import { ModalContext, QuotaContext } from "../Main.tsx";

import { useContext } from "react";

export function ConnectedDevice() {
    const modal = useContext(ModalContext);
    const statusQuotasSignal = useContext(QuotaContext);
    const isThisDevice = !!statusQuotasSignal.value?.some((v) => v.thisDevice);
    const quotaMap = new Map();

    statusQuotasSignal.value?.forEach((v) => {
        if (quotaMap.has(v.parentQuotaId)) {
            quotaMap.set(v.parentQuotaId, [...quotaMap.get(v.parentQuotaId), v]);
        } else {
            quotaMap.set(v.parentQuotaId, [v]);
        }
    });

    const canConnect = Array.from(quotaMap.entries()).some(([_, v]) => v.length < v[0]?.maxDevices);

    if (Array.isArray(statusQuotasSignal.value)) {
        // At if we don't have an entry with this device set to true but the list is not empty, assume device limit has been reached
        if (statusQuotasSignal.value.length > 0) {
            // If this device has not quota assume the limit has been reached
            if (!isThisDevice) {
                return (
                    <>
                        <div className=" flex justify-between  items-center  gap-4 p-4 bg-purple-50 border border-red-200 rounded-xl">
                            <div className="gap-4 flex  items-center ">
                                <AiOutlineExclamationCircle size={24} className="text-red-500" />
                                {canConnect
                                    ? (
                                        <div>
                                            <h3 className="font-bold ">
                                                This device doesn't have an active quota
                                            </h3>
                                            <span className="text-xs ">
                                                Disconnect and connect wifi to activate with an
                                                existing quota.
                                            </span>
                                        </div>
                                    )
                                    : (
                                        <div>
                                            <h3 className="font-bold ">Maximum devices reached</h3>
                                            <span className="text-xs ">
                                                All Packages are full, buy a new package or
                                                disconect an existing device.
                                            </span>
                                        </div>
                                    )}
                            </div>
                            <button
                                className="btn hover:bg-red-200"
                                onClick={() => modal.value = "connectedDevices"}
                            >
                                See Connected
                            </button>
                        </div>
                    </>
                );
            } else {
                return (
                    <>
                        <div className=" flex justify-between  items-center  gap-4 p-4 bg-green-50 border border-green-200 rounded-xl">
                            <div className="gap-4 flex  items-center ">
                                <AiOutlineCheckCircle size={24} className="text-green-500" />
                                <div>
                                    <h3 className="font-bold ">This device is active.</h3>
                                    <span className="text-xs ">
                                        You can manage your connected devices here.
                                    </span>
                                </div>
                            </div>
                            <button
                                className="btn hover:bg-green-100"
                                onClick={() => modal.value = "connectedDevices"}
                            >
                                See Connected
                            </button>
                        </div>
                    </>
                );
            }
        }
        if (statusQuotasSignal.value?.length === 0) {
            return (
                <div className=" flex justify-between  items-center  gap-4 p-4 bg-purple-50 border border-red-200 rounded-xl">
                    <div className="gap-4 flex  items-center ">
                        <AiOutlineExclamationCircle size={24} className="text-red-500" />
                        <div>
                            <h3 className="font-bold ">No active package found</h3>
                            <span className="text-xs ">
                                Buy a new package below to be able to browse the internet.
                            </span>
                        </div>
                    </div>
                </div>
            );
        }
        return null;
    } else {
        return (
            <div className=" flex justify-between  items-center  gap-4 p-4 bg-purple-50 border border-red-200 rounded-xl">
                <div className="gap-4 flex  items-center ">
                    <AiOutlineExclamationCircle size={24} className="text-red-500" />
                    <div>
                        <h3 className="font-bold ">User not logged in</h3>
                        <span className="text-xs ">
                            Login with your username and pin to be able to see you active quota
                            status.
                        </span>
                    </div>
                </div>
            </div>
        );
    }
}
