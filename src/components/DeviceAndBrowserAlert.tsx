import { useEffect, useState } from "react";

interface AlertPropsType {
    mobile: boolean;
    chrome: boolean;
}

export default function DeviceAndBrowserAlert({ mobile, chrome }: AlertPropsType) {
    const [showAlert, setShowAlert] = useState(false);
    const [alertMessage, setAlertMessage] = useState("");

    useEffect(() => {
        if (!mobile && !chrome) {
            setAlertMessage(
                "This is a mobile app and works best with Google Chrome browser. Please open it on your mobile using Chrome."
            );
            setShowAlert(true);
        } else if (!mobile) {
            setAlertMessage(
                "This is a mobile app and works best with Google Chrome browser. Please open it on your mobile using Chrome."
            );
            setShowAlert(true);
        } else if (!chrome) {
            setAlertMessage(
                "This app demo works best with Google Chrome browser. Please open it on Chrome."
            );
            setShowAlert(true);
        }
    }, []);

    if (!showAlert) return null;

    return (
        <div className="fixed inset-0 bg-white text-black flex items-center justify-center text-center px-6 py-4 z-[9999]">
            <div className="max-w-md text-2xl font-semibold">{alertMessage}</div>
        </div>
    );
}
