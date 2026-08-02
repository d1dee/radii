import { Alert } from "@mantine/core";
import { useState } from "react";
import type { ReactNode } from "react";

export type T_Alert = {
    type: "alert-info" | "alert-success" | "alert-warning" | "alert-error";
    style: "alert-soft" | "alert-outline" | "alert-dash";
    message: string | ReactNode;
};

const COLOR_MAP: Record<T_Alert["type"], string> = {
    "alert-info": "blue",
    "alert-success": "green",
    "alert-warning": "yellow",
    "alert-error": "red",
};

export function Toast({ values }: { values: T_Alert }) {
    const [isShown, setIsShown] = useState(true);
    setTimeout(() => setIsShown(false), 3e3);

    if (!isShown) return null;

    return (
        <Alert
            color={COLOR_MAP[values.type]}
            variant="light"
            radius="md"
            mt="sm"
        >
            {values.message}
        </Alert>
    );
}
