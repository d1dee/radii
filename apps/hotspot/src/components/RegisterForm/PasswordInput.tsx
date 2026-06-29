/* import { useContext } from "react";

export function PasswordInpout() {
    const showPassword = useContext(showPassword);
    return (
        <div>
            <label
                htmlFor="password"
                className="inline-flex items-center relative max-w-xs my-2"
            >
                Password:
            </label>
            <div className="inline-flex relative min-w-full items-center">
                <div className="inline-flex relative items-center min-w-full">
                    <span className="absolute pl-5  text-primary">
                        <FaKey />
                    </span>

                    <input
                        id="password"
                        name="password"
                        placeholder="*********"
                        type={stateSignal.value.showPassword ? "text" : "password"}
                        className={`input input-bordered min-w-full pl-12 text-sm  ${
                            errors.password && "input-error"
                        }`}
                        onInput={() => onInput("password")}
                    />
                    <span
                        className="absolute m-5 right-0 text-info"
                        onClick={() => {
                            stateSignal.value = {
                                ...stateSignal.value,
                                showPassword: !stateSignal.value.showPassword,
                            };
                        }}
                    >
                        {!stateSignal.value.showPassword ? <FaEye /> : <FaEyeSlash />}
                    </span>
                </div>
            </div>
            <div className="label">
                {errors.password && <span className="label-text-alt text-error">{errors.password}
                </span>}
            </div>
        </div>
    );
}
    (
                <>
                    <div>
                        <label
                            htmlFor="verify_password"
                            className="inline-flex items-center relative max-w-xs my-2"
                        >
                            Verify password:
                        </label>
                        <div className="inline-flex relative min-w-full items-center">
                            <div className="inline-flex relative items-center min-w-full">
                                <span className="absolute pl-5  text-primary">
                                    <FaKey />
                                </span>

                                <input
                                    id="verify_password"
                                    placeholder="*********"
                                    type={stateSignal.value.showPassword ? "text" : "password"}
                                    name="verifyPassword"
                                    className={`input input-bordered min-w-full text-sm  pl-12 ${
                                        errors.verifyPassword && "input-error"
                                    }`}
                                    onInput={() => onInput("verifyPassword")}
                                />
                                <span
                                    className="absolute m-5 right-0 text-info"
                                    onClick={() => {
                                        stateSignal.value = {
                                            ...stateSignal.value,
                                            showPassword: !stateSignal.value.showPassword,
                                        };
                                    }}
                                >
                                    {!stateSignal.value.showPassword ? <FaEye /> : <FaEyeSlash />}
                                </span>
                            </div>
                        </div>
                        <div className="label">
                            {errors.verifyPassword && (
                                <span className="label-text-alt text-error">
                                    {errors.verifyPassword}
                                </span>
                            )}
                        </div>
                    </div>



                </>
            )
 */