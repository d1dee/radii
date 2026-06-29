import { FaPhone } from "react-icons/fa";
import { useContext } from "react";
import { FormErrors } from "./Form.tsx";

export function PhoneNumber() {
    const errors = useContext(FormErrors);
    return (
        <div>
            <label
                htmlFor="phone_number"
                className="inline-flex items-center relative max-w-xs mb-1"
            >
                Phone number:
            </label>
            <div className="inline-flex relative min-w-full items-center">
                <div className="inline-flex relative items-center min-w-full">
                    <span className="absolute pl-3 sm:pl-5  text-primary">
                        <FaPhone />
                    </span>

                    <input
                        id="phone_number"
                        name="phoneNumber"
                        autoComplete="tel"
                        inputMode="numeric"
                        placeholder="+254712345678 / 0712345678"
                        className={`input input-bordered min-w-full pl-8 sm:pl-12 text-sm ${
                            errors.value.phoneNumber && "input-error"
                        }`}
                        onKeyDown={(e) =>
                            e.key.length === 1 &&
                            (errors.value = { ...errors.value, phoneNumber: "" })}
                    />
                </div>
            </div>
            {errors.value.phoneNumber
                ? <span className="label-text-alt text-error">{errors.value.phoneNumber}</span>
                : null}
        </div>
    );
}
