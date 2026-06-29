import { IoIosCloseCircleOutline } from "react-icons/io";
import type { ReactNode } from "react";
import { useContext } from "react";
import { ModalContext } from "./Main.tsx";

export default function Modal(
    { children }: { children: ReactNode },
) {
    const modal = useContext(ModalContext);
    return (
        <dialog
            className="modal backdrop-blur-sm backdrop-brightness-75"
            open
        >
            <div className="modal-box max-w-[638px] bg-white gap-2">
                <button
                    className="btn btn-circle btn-ghost m-0 p-0 absolute right-2 top-2 min-w-fit"
                    onClick={() => {
                        modal.value = undefined;
                    }}
                >
                    <IoIosCloseCircleOutline className="h-6 w-6 hover:text-red-400" />
                </button>

                <div className="block w-full ">
                    {children}
                </div>
            </div>
            <div
                className="modal-backdrop "
                onClick={() => {
                    modal.value = undefined;
                }}
            />
        </dialog>
    );
}
