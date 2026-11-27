export function LoadingContent({ fullPage = false }: { fullPage?: boolean }) {
    return (
        <div
            className={`admin-loading${fullPage ? ' admin-loading-full' : ''}`}
            role='status'
        >
            Loading admin console...
        </div>
    );
}
