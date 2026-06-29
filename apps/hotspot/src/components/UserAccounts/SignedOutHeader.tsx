import { useContext } from "react";
import { ModalContext } from "../Main.tsx";

export function SigninSignup() {
    const modal = useContext(ModalContext);
    return (
        <div className="w-full">
            <h2 className="text-xl font-semibold mb-2">Hello,</h2>
            <p className="text-sm text-gray-300 pb-4">
                Sign in or{" "}
                <a
                    className="link"
                    onClick={() => {
                        modal.value = "register";
                    }}
                >
                    create an account
                </a>{" "}
                to continue.
            </p>
            <div className="flex flex-col items-end">
                <div
                    className="btn "
                    onClick={() => {
                        modal.value = "login";
                    }}
                >
                    <span className="mx-4">
                        Sign in
                    </span>
                </div>
            </div>
        </div>
    );
}
