import { useContext } from "react";
import { FormErrors } from "./Form.tsx";

export function Terms() {
    const errors = useContext(FormErrors);
    return (
        <div className="flex items-center mt-4 mb-4">
            <input
                type="checkbox"
                name="terms"
                className={`checkbox ${errors.value.terms && "checkbox-error"}`}
                required
                onInput={() => errors.value = { ...errors.value, terms: "" }}
            />
            <label
                htmlFor="terms"
                className={` ms-2 text-sm ${errors.value.terms ? " text-error" : "text-slate-500"}`}
            >
                I accept the{" "}
                <a
                    className="font-medium link text-sm "
                    href={`/terms?${location.search}}`}
                >
                    Terms and Conditions
                </a>
            </label>
        </div>
    );
}
