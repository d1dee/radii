import { useContext } from "react";
import { ModalContext } from "../Main.tsx";
import Modal from "../Modal.tsx";
import { RegisterForm } from "./Form.tsx";

export default function RegisterModal() {
    const modal = useContext(ModalContext);

    function switchModal() {
        modal.value = modal.value === "register" ? "login" : "register";
    }

    return ((modal.value === "register" || modal.value === "login")
        ? (
            <Modal>
                <div className="flex flex-col gap-2">
                    <div className="">
                        <h3 className="text-xl font-bold ">Welcome!</h3>
                        <p className="text-sm text-slate-500 font-extralight">
                            {modal.value === "register" ? " Create an " : "Login to your "}
                            account to manage your service anytime.
                        </p>
                    </div>
                    <RegisterForm />

                    <div className="divider italic text-sm sm:m-2 sm:p-2">or</div>

                    <button
                        className="btn shadow-lg flex-grow"
                        onClick={switchModal}
                    >
                        {modal.value === "login" ? "Register" : "Login"}
                    </button>
                </div>
            </Modal>
        )
        : null);
}
