import Modal from "../Modal.tsx";
import { Form } from "./Form.tsx";

export function BuyPackage() {
    return (
        <Modal>
            <div className="space-y-4">
                <div className="space-y-2">
                    <h3 className="text-xl font-bold ">Top-Up</h3>
                    <p className="text-sm text-slate-500 font-extralight">
                        Pay for hotspot access using a saved number or enter a new one to continue.
                    </p>
                </div>
                <Form />
            </div>
        </Modal>
    );
}
