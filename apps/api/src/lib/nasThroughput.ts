import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { scopedNasHistoryAddress } from './nasHistory';

export type NasThroughputRange = 'hour' | 'day' | 'month';
export type NasThroughputWindow = NasThroughputRange | { from: Date; to: Date };

export const nasThroughputRanges = {
    hour: { seconds: 3600, bucketSeconds: 60 },
    day: { seconds: 86400, bucketSeconds: 300 },
    month: { seconds: 30 * 86400, bucketSeconds: 3600 },
} as const;

export function nasThroughputConfig(range: NasThroughputWindow, now = new Date()) {
    if (typeof range === 'string') {
        const { seconds, bucketSeconds } = nasThroughputRanges[range];
        return {
            from: new Date(now.getTime() - seconds * 1000),
            to: now,
            bucketSeconds,
            count: seconds / bucketSeconds,
        };
    }
    const duration = range.to.getTime() - range.from.getTime();
    const to = new Date(Math.min(range.to.getTime(), now.getTime()));
    if (
        !Number.isFinite(duration) ||
        duration <= 0 ||
        duration > 366 * 86400 * 1000 ||
        range.from >= to
    ) {
        throw new RangeError(
            'Invalid throughput dates: require from < to, from before now, and at most 366 days',
        );
    }
    const seconds = (to.getTime() - range.from.getTime()) / 1000;
    const bucketSeconds = Math.max(60, Math.ceil(seconds / 720 / 60) * 60);
    return {
        from: range.from,
        to,
        bucketSeconds,
        count: Math.ceil(seconds / bucketSeconds),
    };
}

export const nasThroughputQuerySchema = z.object({
    range: z.enum(['hour', 'day', 'month']).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
}).transform((query, ctx): NasThroughputWindow => {
    if (query.from === undefined && query.to === undefined) return query.range ?? 'day';
    if (query.from === undefined || query.to === undefined || query.range !== undefined) {
        ctx.addIssue({ code: 'custom', message: 'Provide both from and to without range' });
        return z.NEVER;
    }
    const range = { from: new Date(query.from), to: new Date(query.to) };
    try {
        nasThroughputConfig(range);
        return range;
    } catch (error) {
        ctx.addIssue({ code: 'custom', message: (error as Error).message });
        return z.NEVER;
    }
});

export type NasThroughputPoint = {
    at: number;
    Upload: number | null;
    Download: number | null;
};

export function nasThroughputQuery(
    adminId: string,
    nasDeviceId: string,
    range: NasThroughputWindow,
    now = new Date(),
) {
    const { from, to, bucketSeconds, count } = nasThroughputConfig(range, now);
    // Rolling windows only scan ends within the window. Custom windows also
    // include intervals crossing their end, but never future observations.
    return sql`
        with bounds as (
            select ${to.toISOString()}::timestamptz as until,
                ${from.toISOString()}::timestamptz as since
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
              and delta.observed_at <= ${typeof range === 'string' ? to.toISOString() : now.toISOString()}::timestamptz
              and coalesce(previous.observed_at, accounting.acctstarttime) < bounds.until
              and accounting.acctstarttime is not null
              and ${scopedNasHistoryAddress(sql`accounting.nasipaddress`, adminId, sql`${nasDeviceId}::uuid`)}
        ), buckets as (
            select bounds.since + n * ${bucketSeconds} * interval '1 second' as started_at,
                least(bounds.until, bounds.since + (n + 1) * ${bucketSeconds} * interval '1 second') as ended_at
            from bounds cross join generate_series(0, ${count - 1}) n
        )
        select (extract(epoch from (buckets.started_at + (buckets.ended_at - buckets.started_at) / 2)) * 1000)::float8 as at,
            (sum(intervals.input_octets::numeric *
                extract(epoch from (least(intervals.ended_at, buckets.ended_at) - greatest(intervals.started_at, buckets.started_at))) /
                nullif(extract(epoch from (intervals.ended_at - intervals.started_at)), 0)
            ) * 8 / extract(epoch from (buckets.ended_at - buckets.started_at)) / 1000000)::float8 as "Upload",
            (sum(intervals.output_octets::numeric *
                extract(epoch from (least(intervals.ended_at, buckets.ended_at) - greatest(intervals.started_at, buckets.started_at))) /
                nullif(extract(epoch from (intervals.ended_at - intervals.started_at)), 0)
            ) * 8 / extract(epoch from (buckets.ended_at - buckets.started_at)) / 1000000)::float8 as "Download"
        from buckets
        left join intervals on intervals.started_at < buckets.ended_at
            and intervals.ended_at > buckets.started_at
            and intervals.ended_at > intervals.started_at
        group by buckets.started_at, buckets.ended_at
        order by buckets.started_at
    `;
}
