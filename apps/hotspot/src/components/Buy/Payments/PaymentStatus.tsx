import { OrderContext } from "../../Main.tsx";

import { useContext } from "react";
import Modal from "../../Modal.tsx";
import { PaymentError } from "./PaymentError.tsx";
import { PendingPayment } from "./PaymentPending.tsx";
import { PaymentSuccess } from "./PaymentSuccess.tsx";

type XHRState = "pending" | "errored" | "success" | undefined;

export function OrderStatus() {
    const order = useContext(OrderContext);
    const status = order.value.status;
    return (
        <Modal>
            {status === "success" ? <PaymentSuccess /> : null}
            {status === "errored" ? <PaymentError /> : null}
            {status === "pending" ? <PendingPayment /> : null}
        </Modal>
    );
}
