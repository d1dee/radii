import { sql } from 'drizzle-orm';
import { scopedNasHistoryAddress } from './nasHistory';

export type NasThroughputRange = 'hour' | 'day' | 'month';

export const nasThroughputRanges = {
    hour: { seconds: 3600, bucketSeconds: 60 },
    day: { seconds: 86400, bucketSeconds: 300 },
    month: { seconds: 30 * 86400, bucketSeconds: 3600 },
} as const;

export type NasThroughputPoint = {
    at: number;
    Upload: number | null;
    Download: number | null;
};

export function nasThroughputQuery(
    adminId: string,
    nasDeviceId: string,
    range: NasThroughputRange,
    now = new Date(),
) {
    const { seconds, bucketSeconds } = nasThroughputRanges[range];
    // Only interval ends in the rolling window are scanned. The indexed lookup
    // still sees earlier history, including the predecessor outside the window.
    return sql`
        with bounds as (
            select ${now.toISOString()}::timestamptz as until,
                ${now.toISOString()}::timestamptz - ${seconds} * interval '1 second' as since
        ), intervals as materialized (
            select delta.observed_at as ended_at,
                coalesce(previous.observed_at, accounting.acctstarttime) as started_at,
                delta.input_octets, delta.output_octets
            from radius_usage_delta delta
            inner join radacct accounting on accounting.radacctid = delta.radacct_id
            cross join bounds
            left join lateral (
                select earlier.observed_at
                from radius_usage_delta earlier
                where earlier.activation_id = delta.activation_id
                  and earlier.radacct_id = delta.radacct_id
                  and (earlier.observed_at, earlier.id) < (delta.observed_at, delta.id)
                order by earlier.observed_at desc, earlier.id desc
                limit 1
            ) previous on true
            where delta.observed_at > bounds.since
              and delta.observed_at <= bounds.until
              and accounting.acctstarttime is not null
              and ${scopedNasHistoryAddress(sql`accounting.nasipaddress`, adminId, sql`${nasDeviceId}::uuid`)}
        ), buckets as (
            select bounds.since + n * ${bucketSeconds} * interval '1 second' as started_at,
                bounds.since + (n + 1) * ${bucketSeconds} * interval '1 second' as ended_at
            from bounds cross join generate_series(0, ${seconds / bucketSeconds - 1}) n
        )
        select (extract(epoch from (buckets.started_at + ${bucketSeconds / 2} * interval '1 second')) * 1000)::float8 as at,
            (sum(intervals.input_octets::numeric *
                extract(epoch from (least(intervals.ended_at, buckets.ended_at) - greatest(intervals.started_at, buckets.started_at))) /
                nullif(extract(epoch from (intervals.ended_at - intervals.started_at)), 0)
            ) * 8 / ${bucketSeconds} / 1000000)::float8 as "Upload",
            (sum(intervals.output_octets::numeric *
                extract(epoch from (least(intervals.ended_at, buckets.ended_at) - greatest(intervals.started_at, buckets.started_at))) /
                nullif(extract(epoch from (intervals.ended_at - intervals.started_at)), 0)
            ) * 8 / ${bucketSeconds} / 1000000)::float8 as "Download"
        from buckets
        left join intervals on intervals.started_at < buckets.ended_at
            and intervals.ended_at > buckets.started_at
            and intervals.ended_at > intervals.started_at
        group by buckets.started_at
        order by buckets.started_at
    `;
}
