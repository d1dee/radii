export function LoadingContent({
    fullPage = false,
    label = 'Loading admin console...',
    height,
}: {
    fullPage?: boolean;
    label?: string;
    height?: number;
}) {
    return (
        <div
            className={`admin-loading${fullPage ? ' admin-loading-full' : ''}`}
            role='status'
            style={height === undefined ? undefined : { minHeight: height }}
        >
            <div className='resource-loader-stage' aria-hidden='true'>
                <div className='resource-loader' />
            </div>
            <span className='resource-loader-label'>{label}</span>
        </div>
    );
}
