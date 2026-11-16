import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export function useDrawerHistory() {
    const location = useLocation();
    const navigate = useNavigate();
    const closingKey = useRef<string | null>(null);
    useEffect(() => {
        closingKey.current = null;
    }, [location.key]);
    const drawer = location.state?.adminDrawer;
    const id: string | null =
        drawer?.pathname === location.pathname && typeof drawer.id === 'string'
            ? drawer.id
            : null;

    const setId = (nextId: string | null) => {
        if (nextId === id) return;
        if (nextId === null) {
            // Ignore repeated close events while the history traversal is pending.
            if (closingKey.current === location.key) return;
            closingKey.current = location.key;
            navigate(-1);
            return;
        }

        // Push the same URL so even Back from a direct page visit stays here.
        // Replacing the selected record must not add another drawer layer.
        navigate(`${location.pathname}${location.search}${location.hash}`, {
            replace: id !== null,
            preventScrollReset: true,
            state: {
                ...location.state,
                adminDrawer: { pathname: location.pathname, id: nextId },
            },
        });
    };

    return [id, setId] as const;
}
