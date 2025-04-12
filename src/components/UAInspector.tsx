import { useEffect, useState } from "react";

// Development component only. No usecase in production
// For inspecting the userAgent of various browsers and help limit access.

export default function UAInspector() {
    const [ua, setUa] = useState("");

    useEffect(() => {
        setUa(navigator.userAgent);
    }, []);

    if (!ua) return null;

    return (
        <div className="fixed bottom-4 right-4 bg-black text-white text-xs p-3 rounded-lg z-50 max-w-sm break-words shadow-md">
            <strong>User Agent:</strong>
            <br />
            {ua}
        </div>
    );
}
